package api

import (
	"net"
	"net/mail"
	"strings"
	"time"
)

func validEmail(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 3 || len(value) > 254 || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	address, err := mail.ParseAddress(value)
	if err != nil || address.Address != value {
		return false
	}
	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	return net.ParseIP(parts[1]) == nil && strings.Contains(parts[1], ".")
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
