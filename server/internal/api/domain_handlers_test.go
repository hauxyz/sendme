package api

import "testing"

func TestSPFAuthorizesIP(t *testing.T) {
	for _, test := range []struct {
		name   string
		record string
		ip     string
		want   bool
	}{
		{name: "exact ip4", record: "v=spf1 ip4:203.0.113.5 -all", ip: "203.0.113.5", want: true},
		{name: "ip4 cidr", record: "v=spf1 ip4:203.0.113.0/24 -all", ip: "203.0.113.5", want: true},
		{name: "not authorized", record: "v=spf1 ip4:198.51.100.5 -all", ip: "203.0.113.5", want: false},
		{name: "negative mechanism", record: "v=spf1 -ip4:203.0.113.5 -all", ip: "203.0.113.5", want: false},
		{name: "uppercase mechanism", record: "v=spf1 IP4:203.0.113.5 -all", ip: "203.0.113.5", want: true},
		{name: "ipv6", record: "v=spf1 ip6:2001:db8::/32 -all", ip: "2001:db8::1", want: true},
		{name: "invalid ip", record: "v=spf1 ip4:203.0.113.5 -all", ip: "not-an-ip", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := spfAuthorizesIP(test.record, test.ip); got != test.want {
				t.Fatalf("spfAuthorizesIP(%q, %q) = %v, want %v", test.record, test.ip, got, test.want)
			}
		})
	}
}

func TestDMARCPolicy(t *testing.T) {
	for _, test := range []struct {
		record string
		want   string
	}{
		{record: "v=DMARC1; p=none; rua=mailto:dmarc@example.com", want: "none"},
		{record: "v=DMARC1; p=QUARANTINE; rua=mailto:dmarc@example.com", want: "quarantine"},
		{record: "v=DMARC1; rua=mailto:dmarc@example.com", want: ""},
	} {
		if got := dmarcPolicy(test.record); got != test.want {
			t.Errorf("dmarcPolicy(%q) = %q, want %q", test.record, got, test.want)
		}
	}
}
