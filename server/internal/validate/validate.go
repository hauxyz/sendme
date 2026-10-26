package validate

import (
	"net"
	"net/mail"
	"strings"
)

// Email reports whether value is a plain email address suitable for use as a
// login or delivery address. Display-name forms such as "Name <a@b.com>" are
// intentionally rejected; callers that accept display names parse them first.
func Email(value string) bool {
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
