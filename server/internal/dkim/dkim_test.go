package dkim

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"strings"
	"testing"
)

func TestGenerate(t *testing.T) {
	privatePEM, publicRecord, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	block, _ := pem.Decode([]byte(privatePEM))
	if block == nil || block.Type != "RSA PRIVATE KEY" {
		t.Fatalf("unexpected private key PEM block: %#v", block)
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("parse private key: %v", err)
	}
	if got := key.N.BitLen(); got != keyBits {
		t.Fatalf("key size = %d, want %d", got, keyBits)
	}
	const prefix = "v=DKIM1; k=rsa; p="
	if !strings.HasPrefix(publicRecord, prefix) {
		t.Fatalf("public record = %q, want prefix %q", publicRecord, prefix)
	}
	if _, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(publicRecord, prefix)); err != nil {
		t.Fatalf("public key is not valid base64: %v", err)
	}
}
