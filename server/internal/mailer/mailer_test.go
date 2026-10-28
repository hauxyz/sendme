package mailer

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hauxyz/sendme/server/internal/dkim"
)

type fakeSMTP struct {
	listener net.Listener
	port     int
	done     chan struct{}

	mu       sync.Mutex
	mailFrom string
	rcptTo   string
	data     string

	rcptReply string
	dataReply string
}

func newFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := &fakeSMTP{
		listener: listener,
		port:     listener.Addr().(*net.TCPAddr).Port,
		done:     make(chan struct{}),
	}
	go server.serve()
	return server
}

func (s *fakeSMTP) serve() {
	defer close(s.done)
	conn, err := s.listener.Accept()
	if err != nil {
		return
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	reader := textproto.NewReader(bufio.NewReader(conn))
	writer := textproto.NewWriter(bufio.NewWriter(conn))
	_ = writer.PrintfLine("220 fake ESMTP")

	for {
		line, err := reader.ReadLine()
		if err != nil {
			return
		}
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO"):
			_ = writer.PrintfLine("250-fake")
			_ = writer.PrintfLine("250-8BITMIME")
			_ = writer.PrintfLine("250 SIZE 10485760")
		case strings.HasPrefix(upper, "HELO"):
			_ = writer.PrintfLine("250 fake")
		case strings.HasPrefix(upper, "MAIL FROM:"):
			s.mu.Lock()
			s.mailFrom = line
			s.mu.Unlock()
			_ = writer.PrintfLine("250 2.1.0 Ok")
		case strings.HasPrefix(upper, "RCPT TO:"):
			s.mu.Lock()
			s.rcptTo = line
			reply := s.rcptReply
			s.mu.Unlock()
			if reply != "" {
				_ = writer.PrintfLine("%s", reply)
				continue
			}
			_ = writer.PrintfLine("250 2.1.5 Ok")
		case upper == "DATA":
			_ = writer.PrintfLine("354 End data with <CR><LF>.<CR><LF>")
			data, err := reader.ReadDotBytes()
			if err != nil {
				return
			}
			s.mu.Lock()
			s.data = string(data)
			reply := s.dataReply
			s.mu.Unlock()
			if reply != "" {
				_ = writer.PrintfLine("%s", reply)
				continue
			}
			_ = writer.PrintfLine("250 2.0.0 Ok: queued")
		case upper == "QUIT":
			_ = writer.PrintfLine("221 2.0.0 Bye")
			return
		case upper == "RSET":
			_ = writer.PrintfLine("250 2.0.0 Ok")
		default:
			_ = writer.PrintfLine("250 2.0.0 Ok")
		}
	}
}

func (s *fakeSMTP) message() (string, string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mailFrom, s.rcptTo, s.data
}

func TestDirectSendDeliversWithDKIM(t *testing.T) {
	privateKey, _, err := dkim.Generate()
	if err != nil {
		t.Fatalf("generate DKIM key: %v", err)
	}
	server := newFakeSMTP(t)
	defer server.listener.Close()

	oldPort, oldLookup := directPort, lookupMXFn
	directPort = server.port
	lookupMXFn = func(_ context.Context, domain string) ([]string, error) {
		if domain != "example.test" {
			return nil, fmt.Errorf("unexpected recipient domain %q", domain)
		}
		return []string{"127.0.0.1"}, nil
	}
	t.Cleanup(func() {
		directPort = oldPort
		lookupMXFn = oldLookup
	})

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = New().Send(ctx, SMTPConfig{
		Mode:      ModeDirect,
		FromEmail: "sender@example.test",
		FromName:  "SendMe Test",
		ReplyTo:   "reply@example.test",
		HeloHost:  "mail.example.test",
		DKIM: &DKIMConfig{
			Domain:        "example.test",
			Selector:      dkim.DefaultSelector,
			PrivateKeyPEM: privateKey,
		},
	}, Message{
		To:             "recipient@example.test",
		Subject:        "Direct delivery test",
		Text:           "Hello from a direct SMTP delivery.",
		MessageID:      "<test@example.test>",
		UnsubscribeURL: "https://example.test/unsubscribe",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}

	select {
	case <-server.done:
	case <-time.After(5 * time.Second):
		t.Fatal("fake SMTP server did not finish")
	}

	mailFrom, rcptTo, data := server.message()
	if !strings.Contains(mailFrom, "sender@example.test") {
		t.Fatalf("MAIL FROM = %q, want sender@example.test", mailFrom)
	}
	if !strings.Contains(rcptTo, "recipient@example.test") {
		t.Fatalf("RCPT TO = %q, want recipient@example.test", rcptTo)
	}
	for _, want := range []string{
		"DKIM-Signature:",
		"Subject: Direct delivery test",
		"Reply-To: <reply@example.test>",
		"List-Unsubscribe: <https://example.test/unsubscribe>",
		"Hello from a direct SMTP delivery.",
	} {
		if !strings.Contains(data, want) {
			t.Errorf("message does not contain %q\n%s", want, data)
		}
	}
}

func TestRelayClassifiesPermanentAndTemporaryRejections(t *testing.T) {
	for _, test := range []struct {
		name          string
		reply         string
		wantPermanent bool
	}{
		{name: "spam rejection", reply: "554 5.7.1 message rejected as spam", wantPermanent: true},
		{name: "unknown recipient", reply: "550 5.1.1 recipient does not exist", wantPermanent: true},
		{name: "greylisted", reply: "451 4.7.1 greylisted, try again later", wantPermanent: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := newFakeSMTP(t)
			defer server.listener.Close()
			server.dataReply = test.reply

			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			err := New().Send(ctx, SMTPConfig{
				Mode:      ModeSMTP,
				Host:      "127.0.0.1",
				Port:      server.port,
				Security:  "none",
				Auth:      "none",
				FromEmail: "sender@example.test",
			}, Message{
				To:      "recipient@example.test",
				Subject: "Rejection test",
				Text:    "Hello.",
			})
			if err == nil {
				t.Fatal("Send() succeeded, want rejection")
			}
			if got := IsPermanent(err); got != test.wantPermanent {
				t.Fatalf("IsPermanent(%v) = %v, want %v", err, got, test.wantPermanent)
			}
		})
	}
}

func TestClassifySMTPError(t *testing.T) {
	for _, test := range []struct {
		message       string
		wantCode      int
		wantPermanent bool
	}{
		{message: "535 5.7.8 authentication failed", wantCode: 535, wantPermanent: true},
		{message: "550 5.7.1 rejected as spam", wantCode: 550, wantPermanent: true},
		{message: "451 4.7.1 try again", wantCode: 451, wantPermanent: false},
		{message: "connection refused", wantCode: 0, wantPermanent: false},
	} {
		code, permanent := classifySMTPError(fmt.Errorf("%s", test.message))
		if code != test.wantCode || permanent != test.wantPermanent {
			t.Errorf("classifySMTPError(%q) = %d, %v; want %d, %v", test.message, code, permanent, test.wantCode, test.wantPermanent)
		}
	}
}

func TestAddressDomain(t *testing.T) {
	for _, test := range []struct {
		address string
		want    string
		ok      bool
	}{
		{"user@example.com", "example.com", true},
		{"user@mail.example.com", "mail.example.com", true},
		{"user@", "", false},
		{"user", "", false},
	} {
		got, err := addressDomain(test.address)
		if test.ok && (err != nil || got != test.want) {
			t.Errorf("addressDomain(%q) = %q, %v; want %q", test.address, got, err, test.want)
		}
		if !test.ok && err == nil {
			t.Errorf("addressDomain(%q) unexpectedly succeeded", test.address)
		}
	}
}
