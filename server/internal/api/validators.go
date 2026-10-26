package api

import (
	"strings"
	"time"

	"github.com/hauxyz/sendme/server/internal/validate"
)

func validEmail(value string) bool {
	return validate.Email(value)
}

func validDomain(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) < 4 || len(value) > 253 || !strings.Contains(value, ".") {
		return false
	}
	if strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") || strings.Contains(value, "..") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			if !(char == '-' || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
				return false
			}
		}
	}
	return true
}

func normalizeDomain(value string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
}

func parseTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
