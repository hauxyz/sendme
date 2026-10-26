package config

import "testing"

func TestLoadDerivesAPIBaseFromAppURL(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("APP_URL", "https://mail.example.com/")
	t.Setenv("COOKIE_SECURE", "")
	t.Setenv("TRUSTED_ORIGINS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got, want := cfg.APIBaseURL, "https://mail.example.com/api"; got != want {
		t.Fatalf("APIBaseURL = %q, want %q", got, want)
	}
	if !cfg.CookieSecure {
		t.Fatal("CookieSecure = false, want true for an HTTPS APP_URL")
	}
	if len(cfg.TrustedOrigins) == 0 || cfg.TrustedOrigins[0] != "https://mail.example.com" {
		t.Fatalf("TrustedOrigins = %v, want APP_URL", cfg.TrustedOrigins)
	}
}
