package auth

import (
	"errors"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const CookieName = "sendme_session"

type Claims struct {
	UserID         string `json:"uid"`
	WorkspaceID    string `json:"wid"`
	SessionVersion int    `json:"sv"`
	jwt.RegisteredClaims
}

type Tokens struct {
	secret     []byte
	sessionTTL time.Duration
	secure     bool
	domain     string
}

func NewTokens(secret []byte, sessionTTL time.Duration, secure bool, domain string) *Tokens {
	return &Tokens{secret: secret, sessionTTL: sessionTTL, secure: secure, domain: domain}
}

func (t *Tokens) Issue(userID, workspaceID string, sessionVersion int) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:         userID,
		WorkspaceID:    workspaceID,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "sendme",
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now.Add(-30 * time.Second)),
			ExpiresAt: jwt.NewNumericDate(now.Add(t.sessionTTL)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(t.secret)
}

func (t *Tokens) Parse(raw string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return t.secret, nil
	}, jwt.WithIssuer("sendme"), jwt.WithExpirationRequired())
	if err != nil || !token.Valid {
		return nil, errors.New("invalid session")
	}
	if claims.UserID == "" || claims.WorkspaceID == "" {
		return nil, errors.New("invalid session claims")
	}
	return claims, nil
}

func (t *Tokens) SetCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Domain:   t.domain,
		HttpOnly: true,
		Secure:   t.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(t.sessionTTL.Seconds()),
	})
}

func (t *Tokens) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		Domain:   t.domain,
		HttpOnly: true,
		Secure:   t.secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
