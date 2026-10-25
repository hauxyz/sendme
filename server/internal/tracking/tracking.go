package tracking

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"html"
	"net/url"
	"regexp"
	"strings"
)

type Service struct {
	secret []byte
	apiURL string
}

func New(secret []byte, apiURL string) *Service {
	return &Service{secret: secret, apiURL: strings.TrimRight(apiURL, "/")}
}

func (s *Service) OpenURL(trackingID string) string {
	return s.apiURL + "/t/o/" + trackingID + ".gif"
}

func (s *Service) ClickURL(trackingID, target string) string {
	encoded := base64.RawURLEncoding.EncodeToString([]byte(target))
	signature := s.sign(trackingID + "." + encoded)
	return s.apiURL + "/t/c/" + trackingID + "?url=" + url.QueryEscape(encoded) + "&sig=" + signature
}

func (s *Service) UnsubscribeURL(contactID string) string {
	signature := s.sign(contactID)
	return s.apiURL + "/u/" + contactID + "." + signature
}

func (s *Service) ValidateClick(trackingID, encodedURL, signature string) (string, bool) {
	expected := s.sign(trackingID + "." + encodedURL)
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(encodedURL)
	if err != nil {
		return "", false
	}
	target := string(raw)
	parsed, err := url.Parse(target)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", false
	}
	return target, true
}

func (s *Service) ValidateUnsubscribe(token string) (string, bool) {
	lastDot := strings.LastIndex(token, ".")
	if lastDot <= 0 || lastDot == len(token)-1 {
		return "", false
	}
	contactID, signature := token[:lastDot], token[lastDot+1:]
	expected := s.sign(contactID)
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return "", false
	}
	return contactID, true
}

func (s *Service) sign(value string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(value))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

var (
	anchorRegexp = regexp.MustCompile(`(?is)<a\s([^>]*?)href\s*=\s*(["'])(.*?)(["'])([^>]*)>`)
	bodyTag      = regexp.MustCompile(`(?is)</body\s*>`)
)

// RewriteHTML injects an open pixel and wraps links in signed click-tracking URLs.
func (s *Service) RewriteHTML(content, trackingID string, trackOpens, trackClicks bool) string {
	if trackClicks {
		content = anchorRegexp.ReplaceAllStringFunc(content, func(anchor string) string {
			parts := anchorRegexp.FindStringSubmatch(anchor)
			if len(parts) != 6 {
				return anchor
			}
			before, quote, target, _, after := parts[1], parts[2], strings.TrimSpace(html.UnescapeString(parts[3])), parts[4], parts[5]
			lower := strings.ToLower(target)
			if target == "" ||
				strings.HasPrefix(lower, "mailto:") ||
				strings.HasPrefix(lower, "tel:") ||
				strings.HasPrefix(lower, "sms:") ||
				strings.HasPrefix(lower, "#") ||
				strings.HasPrefix(lower, "javascript:") ||
				strings.Contains(lower, "/u/") ||
				strings.Contains(lower, "/t/c/") {
				return anchor
			}
			tracked := html.EscapeString(s.ClickURL(trackingID, target))
			return "<a " + before + "href=" + quote + tracked + quote + after + ">"
		})
	}

	if trackOpens {
		pixel := `<img src="` + html.EscapeString(s.OpenURL(trackingID)) + `" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;text-decoration:none;" />`
		if bodyTag.MatchString(content) {
			content = bodyTag.ReplaceAllString(content, pixel+"</body>")
		} else {
			content += pixel
		}
	}
	return content
}

func UnsubscribeFooter(unsubscribeURL string) string {
	return `<div style="margin-top:40px;padding-top:24px;border-top:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:12px;line-height:1.6;font-family:Arial,sans-serif;">` +
		`You are receiving this email because you subscribed to our updates.<br>` +
		`<a href="` + html.EscapeString(unsubscribeURL) + `" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
		`</div>`
}

// PlainText converts common HTML markup into a readable plain-text fallback.
func PlainText(content string) string {
	replacements := []struct{ pattern, replacement string }{
		{`(?is)<style.*?</style>`, " "},
		{`(?is)<script.*?</script>`, " "},
		{`(?is)<br\s*/?>`, "\n"},
		{`(?is)</(p|div|h[1-6]|li|tr)>`, "\n"},
		{`(?is)<li[^>]*>`, "- "},
		{`(?is)<[^>]+>`, " "},
	}
	result := content
	for _, item := range replacements {
		result = regexp.MustCompile(item.pattern).ReplaceAllString(result, item.replacement)
	}
	result = html.UnescapeString(result)
	result = regexp.MustCompile(`[ \t]+`).ReplaceAllString(result, " ")
	result = regexp.MustCompile(`\n\s*\n\s*\n+`).ReplaceAllString(result, "\n\n")
	return strings.TrimSpace(result)
}
