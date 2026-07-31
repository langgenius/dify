// Package aws implements the "aws-sigv4" credential injection policy:
// it re-signs matching requests with AWS Signature Version 4 using the
// credential's structured value (access key id, secret access key, optional
// session token).
//
// Any client-supplied AWS auth headers are stripped before re-signing, so
// both unsigned requests (curl) and requests signed with dummy credentials
// work transparently — the proxy overwrites the signature with real credentials.
//
// The body signing mode is auto-detected from the client's
// X-Amz-Content-Sha256 header:
//
//   - hex SHA-256 hash: buffer body (≤10 MiB), compute hash, sign with it.
//   - "UNSIGNED-PAYLOAD": sign headers only, no body hash.
//   - "STREAMING-UNSIGNED-PAYLOAD-TRAILER": stream body through, sign headers
//     only with this constant as the hash.
//   - other "STREAMING-*" variants: rejected (cannot reproduce per-chunk
//     signatures).
//   - absent: treated as "UNSIGNED-PAYLOAD".
//
// Region is extracted from the request hostname (e.g. s3.us-east-1.amazonaws.com)
// unless Region is set explicitly. Service defaults to "s3" if empty.
package aws

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awssigner "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

// Credentials holds the three fields needed for AWS Signature Version 4.
type Credentials struct {
	AccessKeyID     string `json:"access_key_id" yaml:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key" yaml:"secret_access_key"`
	SessionToken    string `json:"session_token,omitempty" yaml:"session_token,omitempty"`
}

// Policy re-signs matching requests with AWS Signature Version 4.
type Policy struct {
	Domains_ []string
	Region   string // explicit override; empty = extract from hostname
	Service  string // e.g. "s3", "execute-api"; empty = "s3"
}

// Compile-time assertion that Policy implements providers.Policy.
var _ interface {
	Domains() []string
	Apply(*http.Request, any) error
} = (*Policy)(nil)

// Domains returns the domain-match patterns for this policy.
func (p *Policy) Domains() []string { return p.Domains_ }

// awsSigV4Headers are the request headers that SigV4 produces and that must
// be stripped before re-signing (whether the client signed with dummy
// credentials or a real key).
var awsSigV4Headers = []string{
	"Authorization",
	"X-Amz-Date",
	"X-Amz-Content-Sha256",
	"X-Amz-Security-Token",
}

// stripBeforeSign are headers that must be removed before re-signing because
// they are either AWS-SDK-internal (not meaningful to the upstream service) or
// hop-by-hop / intermediary-modifiable (an upstream proxy like Squid may alter
// or remove them, which would break the signature).
var stripBeforeSign = []string{
	"Accept-Encoding", // Squid may modify/remove this
	"Amz-Sdk-Invocation-Id",
	"Amz-Sdk-Request",
	"Amz-Sdk-Request-Attempt",
	"X-Amzn-Sdk-Version",
	"X-Amzn-Trace-Id",
}

// MaxBodyBytes is the maximum body size that will be buffered for SHA-256
// hashing in "signed body" mode. Larger bodies in that mode are rejected.
const MaxBodyBytes = 10 * 1024 * 1024 // 10 MiB

// Apply strips client AWS auth headers and re-signs req with real credentials.
func (p *Policy) Apply(req *http.Request, value any) error {
	log.Printf("aws-sigv4: Apply called for host=%s, method=%s, url=%s", req.URL.Hostname(), req.Method, req.URL.String())
	log.Printf("aws-sigv4: before strip, Authorization=%q, X-Amz-Content-Sha256=%q", req.Header.Get("Authorization"), req.Header.Get("X-Amz-Content-Sha256"))
	creds, err := DecodeCredentials(value)
	if err != nil {
		return fmt.Errorf("decode credentials: %w", err)
	}
	log.Printf("aws-sigv4: decoded creds, AccessKeyID=%q", creds.AccessKeyID)

	// Determine body signing mode from the client's x-amz-content-sha256.
	contentSha := req.Header.Get("X-Amz-Content-Sha256")
	mode, err := bodyMode(contentSha)
	if err != nil {
		return err
	}

	// Strip any client-supplied AWS auth headers before re-signing.
	for _, h := range awsSigV4Headers {
		req.Header.Del(h)
	}
	// Strip headers that intermediaries (Squid) might modify or that are
	// SDK-internal, so they don't end up in the signed headers list.
	for _, h := range stripBeforeSign {
		req.Header.Del(h)
	}

	// Compute payload hash and handle body buffering.
	payloadHash, err := p.handleBody(req, mode)
	if err != nil {
		return err
	}

	// Resolve region and service.
	region := p.Region
	if region == "" {
		region, err = ExtractRegionFromHost(req.URL.Hostname())
		if err != nil {
			return err
		}
	}
	service := p.Service
	if service == "" {
		service = "s3"
	}

	// Build AWS credentials and signer.
	awsCreds := aws.Credentials{
		AccessKeyID:     creds.AccessKeyID,
		SecretAccessKey: creds.SecretAccessKey,
		SessionToken:    creds.SessionToken,
	}
	signer := awssigner.NewSigner()

	// SignHTTP adds Authorization, X-Amz-Date to req.Header. It does NOT
	// add X-Amz-Content-Sha256 or X-Amz-Security-Token automatically, so we
	// set them explicitly after signing.
	if err := signer.SignHTTP(req.Context(), awsCreds, req, payloadHash, service, region, time.Now()); err != nil {
		return fmt.Errorf("sign request: %w", err)
	}
	// Ensure X-Amz-Content-Sha256 is present on the outgoing request so
	// the upstream service can verify the payload hash.
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	log.Printf("aws-sigv4: after sign, region=%q, service=%q, payloadHash=%q", region, service, payloadHash)
	log.Printf("aws-sigv4: after sign, Authorization=%q", req.Header.Get("Authorization"))
	log.Printf("aws-sigv4: after sign, X-Amz-Date=%q, X-Amz-Content-Sha256=%q", req.Header.Get("X-Amz-Date"), req.Header.Get("X-Amz-Content-Sha256"))
	// X-Amz-Security-Token is added by the signer when SessionToken is set.
	return nil
}

// bodyMode determines how the request body should be treated during signing,
// based on the client-supplied X-Amz-Content-Sha256 header value.
func bodyMode(contentSha string) (string, error) {
	switch {
	case contentSha == "":
		return "UNSIGNED-PAYLOAD", nil
	case contentSha == "UNSIGNED-PAYLOAD":
		return "UNSIGNED-PAYLOAD", nil
	case contentSha == "STREAMING-UNSIGNED-PAYLOAD-TRAILER":
		return "STREAMING-UNSIGNED-PAYLOAD-TRAILER", nil
	case strings.HasPrefix(contentSha, "STREAMING-"):
		return "", fmt.Errorf("chunk-signed streaming mode %q is not supported (use unsigned payload)", contentSha)
	case isHex64(contentSha):
		return "signed", nil
	default:
		return "", fmt.Errorf("unrecognized x-amz-content-sha256 value %q", contentSha)
	}
}

// handleBody processes the request body according to the signing mode and
// returns the payload hash to use for signing. For "signed" mode the body is
// buffered (up to MaxBodyBytes) and its SHA-256 computed. For other modes
// the body is left untouched and the mode string itself is used as the hash
// (per AWS spec).
func (p *Policy) handleBody(req *http.Request, mode string) (string, error) {
	switch mode {
	case "signed":
		if req.Body == nil || req.Body == http.NoBody {
			h := sha256.Sum256(nil)
			return hex.EncodeToString(h[:]), nil
		}
		body, err := io.ReadAll(io.LimitReader(req.Body, MaxBodyBytes+1))
		if err != nil {
			return "", fmt.Errorf("read body: %w", err)
		}
		if len(body) > MaxBodyBytes {
			return "", fmt.Errorf("body exceeds %d bytes for signed mode", MaxBodyBytes)
		}
		h := sha256.Sum256(body)
		req.Body = io.NopCloser(bytes.NewReader(body))
		req.ContentLength = int64(len(body))
		return hex.EncodeToString(h[:]), nil
	case "UNSIGNED-PAYLOAD":
		return "UNSIGNED-PAYLOAD", nil
	case "STREAMING-UNSIGNED-PAYLOAD-TRAILER":
		return "STREAMING-UNSIGNED-PAYLOAD-TRAILER", nil
	default:
		return mode, nil
	}
}

// isHex64 reports whether s is a 64-character lowercase hex string (a SHA-256
// digest).
func isHex64(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// ExtractRegionFromHost attempts to extract an AWS region from a hostname.
// Recognized patterns:
//   - <service>.<region>.amazonaws.com  (e.g. s3.us-east-1.amazonaws.com)
//   - <service>-<region>.amazonaws.com   (e.g. s3-us-west-2.amazonaws.com)
//   - <account>.r2.cloudflarestorage.com → "auto" (R2 is region-less)
func ExtractRegionFromHost(host string) (string, error) {
	host = strings.ToLower(host)
	if strings.HasSuffix(host, ".r2.cloudflarestorage.com") {
		return "auto", nil
	}
	// <service>.<region>.amazonaws.com
	if strings.HasSuffix(host, ".amazonaws.com") {
		parts := strings.Split(host, ".")
		// e.g. ["s3", "us-east-1", "amazonaws", "com"]
		if len(parts) >= 4 && parts[len(parts)-2] == "amazonaws" {
			region := parts[len(parts)-3]
			if isAWSRegion(region) {
				return region, nil
			}
		}
		// e.g. ["s3-us-west-2", "amazonaws", "com"]
		if len(parts) >= 3 {
			first := parts[0]
			if idx := strings.Index(first, "-"); idx >= 0 {
				region := first[idx+1:]
				if isAWSRegion(region) {
					return region, nil
				}
			}
		}
	}
	return "", fmt.Errorf("cannot extract AWS region from host %q (set region in policy)", host)
}

// isAWSRegion does a light sanity check that the string looks like an AWS
// region (contains a digit and a dash, e.g. "us-east-1", "ap-southeast-2").
func isAWSRegion(s string) bool {
	hasDigit, hasDash := false, false
	for _, c := range s {
		switch {
		case c >= '0' && c <= '9':
			hasDigit = true
		case c == '-':
			hasDash = true
		}
	}
	return hasDigit && hasDash
}

// DecodeCredentials converts a credential Value into Credentials. Accepts
// Credentials, map[string]any, json.RawMessage, []byte, or a JSON string.
func DecodeCredentials(value any) (*Credentials, error) {
	switch v := value.(type) {
	case *Credentials:
		return v, nil
	case Credentials:
		return &v, nil
	case map[string]any:
		return decodeCredsFromMap(v)
	case json.RawMessage:
		var c Credentials
		if err := json.Unmarshal(v, &c); err != nil {
			return nil, err
		}
		if c.AccessKeyID == "" || c.SecretAccessKey == "" {
			return nil, fmt.Errorf("access_key_id and secret_access_key are required")
		}
		return &c, nil
	case []byte:
		var c Credentials
		if err := json.Unmarshal(v, &c); err != nil {
			return nil, err
		}
		if c.AccessKeyID == "" || c.SecretAccessKey == "" {
			return nil, fmt.Errorf("access_key_id and secret_access_key are required")
		}
		return &c, nil
	case string:
		// Try JSON object first, then treat as raw access key (not supported
		// for SigV4 which needs both access key and secret).
		var c Credentials
		if err := json.Unmarshal([]byte(v), &c); err == nil && c.AccessKeyID != "" && c.SecretAccessKey != "" {
			return &c, nil
		}
		return nil, fmt.Errorf("aws-sigv4 requires structured credentials (access_key_id + secret_access_key)")
	default:
		return nil, fmt.Errorf("unsupported credential value type %T", value)
	}
}

func decodeCredsFromMap(m map[string]any) (*Credentials, error) {
	c := &Credentials{}
	if v, ok := m["access_key_id"].(string); ok {
		c.AccessKeyID = v
	}
	if v, ok := m["secret_access_key"].(string); ok {
		c.SecretAccessKey = v
	}
	if v, ok := m["session_token"].(string); ok {
		c.SessionToken = v
	}
	if c.AccessKeyID == "" || c.SecretAccessKey == "" {
		return nil, fmt.Errorf("access_key_id and secret_access_key are required")
	}
	return c, nil
}
