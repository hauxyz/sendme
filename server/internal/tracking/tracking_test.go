package tracking

import (
	"strings"
	"testing"
)

func TestLinksUsePublicAPIBase(t *testing.T) {
	service := New([]byte("test-secret"), "https://mail.example.com/api/")

	if got, want := service.OpenURL("abc"), "https://mail.example.com/api/t/o/abc.gif"; got != want {
		t.Fatalf("OpenURL() = %q, want %q", got, want)
	}

	click := service.ClickURL("abc", "https://example.com/landing")
	if !strings.HasPrefix(click, "https://mail.example.com/api/t/c/abc?url=") {
		t.Fatalf("ClickURL() = %q, want public API base", click)
	}

	unsubscribe := service.UnsubscribeURL("contact-id")
	if !strings.HasPrefix(unsubscribe, "https://mail.example.com/api/u/contact-id.") {
		t.Fatalf("UnsubscribeURL() = %q, want public API base", unsubscribe)
	}
}
