// Package dkim generates DKIM signing keys for domains that SendMe delivers
// to directly over SMTP.
package dkim

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
)

const (
	// DefaultSelector is used for every SendMe-managed domain.
	DefaultSelector = "sendme"
	keyBits         = 2048
)

// Generate creates a new RSA private key and the matching DNS TXT record value.
// The private key is returned as PKCS#1 PEM so it can be encrypted at rest.
func Generate() (privateKeyPEM, publicRecord string, err error) {
	key, err := rsa.GenerateKey(rand.Reader, keyBits)
	if err != nil {
		return "", "", fmt.Errorf("generate DKIM key: %w", err)
	}
	privateDER := x509.MarshalPKCS1PrivateKey(key)
	privateKeyPEM = string(pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: privateDER,
	}))

	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return "", "", fmt.Errorf("encode DKIM public key: %w", err)
	}
	publicRecord = "v=DKIM1; k=rsa; p=" + base64.StdEncoding.EncodeToString(publicDER)
	return privateKeyPEM, publicRecord, nil
}
