package config

import (
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Env               string
	Port              string
	DatabaseURL       string
	RedisURL          string
	JWTSecret         string
	SigningSecret     []byte
	EncryptionKey     []byte
	AppURL            string
	APIPublicURL      string
	CookieSecure      bool
	CookieDomain      string
	SessionTTL        time.Duration
	WorkerEnabled     bool
	WorkerConcurrency int
	TrustedOrigins    []string
}

func Load() (*Config, error) {
	loadEnvFiles()

	env := envOr("APP_ENV", "development")
	port := envOr("PORT", "8080")
	appURL := strings.TrimRight(envOr("APP_URL", "http://localhost:3000"), "/")
	apiURL := strings.TrimRight(envOr("API_PUBLIC_URL", "http://localhost:"+port), "/")

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		if env == "production" {
			return nil, fmt.Errorf("JWT_SECRET is required in production")
		}
		jwtSecret = "sendme-development-secret-change-me-please-0123456789"
		slog.Warn("JWT_SECRET is not set, using an insecure development secret")
	}

	encryptionKey, err := loadEncryptionKey(env, jwtSecret)
	if err != nil {
		return nil, err
	}

	ttl := 7 * 24 * time.Hour
	if raw := os.Getenv("SESSION_TTL"); raw != "" {
		ttl, err = time.ParseDuration(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid SESSION_TTL: %w", err)
		}
	}

	workerEnabled := true
	if raw := os.Getenv("WORKER_ENABLED"); raw != "" {
		workerEnabled, err = strconv.ParseBool(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid WORKER_ENABLED: %w", err)
		}
	}

	concurrency := 10
	if raw := os.Getenv("WORKER_CONCURRENCY"); raw != "" {
		concurrency, err = strconv.Atoi(raw)
		if err != nil || concurrency < 1 {
			return nil, fmt.Errorf("invalid WORKER_CONCURRENCY")
		}
	}

	cookieSecure := strings.HasPrefix(apiURL, "https://")
	if raw := os.Getenv("COOKIE_SECURE"); raw != "" {
		cookieSecure, err = strconv.ParseBool(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid COOKIE_SECURE: %w", err)
		}
	}

	origins := []string{appURL}
	if raw := os.Getenv("TRUSTED_ORIGINS"); raw != "" {
		for _, origin := range strings.Split(raw, ",") {
			origin = strings.TrimSpace(origin)
			if origin != "" {
				origins = append(origins, origin)
			}
		}
	}

	signingSecret := os.Getenv("SIGNING_SECRET")
	if signingSecret == "" {
		signingSecret = jwtSecret
	}

	return &Config{
		Env:               env,
		Port:              port,
		DatabaseURL:       envOr("DATABASE_URL", "postgres://sendme:sendme@localhost:5432/sendme?sslmode=disable"),
		RedisURL:          envOr("REDIS_URL", "redis://localhost:6379/0"),
		JWTSecret:         jwtSecret,
		SigningSecret:     []byte(signingSecret),
		EncryptionKey:     encryptionKey,
		AppURL:            appURL,
		APIPublicURL:      apiURL,
		CookieSecure:      cookieSecure,
		CookieDomain:      os.Getenv("COOKIE_DOMAIN"),
		SessionTTL:        ttl,
		WorkerEnabled:     workerEnabled,
		WorkerConcurrency: concurrency,
		TrustedOrigins:    origins,
	}, nil
}

func loadEncryptionKey(env, jwtSecret string) ([]byte, error) {
	raw := os.Getenv("ENCRYPTION_KEY")
	if raw == "" {
		if env == "production" {
			return nil, fmt.Errorf("ENCRYPTION_KEY is required in production (base64 encoded 32-byte key)")
		}
		sum := sha256.Sum256([]byte(jwtSecret))
		slog.Warn("ENCRYPTION_KEY is not set, deriving an insecure development key")
		return sum[:], nil
	}

	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		key, err = base64.RawURLEncoding.DecodeString(raw)
	}
	if err != nil || len(key) != 32 {
		return nil, fmt.Errorf("ENCRYPTION_KEY must be a base64 encoded 32-byte value")
	}
	return key, nil
}

func envOr(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// loadEnvFiles loads the first .env file that exists. godotenv.Load stops at
// the first missing path, so passing several candidate paths at once would
// skip the root .env when the server runs from the server/ directory.
func loadEnvFiles() {
	for _, path := range []string{".env", "../.env"} {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := godotenv.Load(path); err != nil {
			slog.Warn("could not load environment file", "path", path, "error", err)
		}
		return
	}
}
