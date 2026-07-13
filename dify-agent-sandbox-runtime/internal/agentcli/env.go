// Package agentcli implements the dify-agent CLI that runs inside the sandbox
// container. It communicates with the Agent Stub server on the host via HTTP
// or gRPC to provide connect, file, drive, and config operations.
package agentcli

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

const (
	EnvAPIBaseURL = "DIFY_AGENT_STUB_API_BASE_URL"
	EnvAuthJWE    = "DIFY_AGENT_STUB_AUTH_JWE"
	EnvDriveBase  = "DIFY_AGENT_STUB_DRIVE_BASE"

	DefaultDriveBase = "/mnt/drive"
)

// Environment holds validated Agent Stub connection parameters.
type Environment struct {
	URL     string
	AuthJWE string
}

// Endpoint represents a parsed Agent Stub endpoint with transport info.
type Endpoint struct {
	URL    string
	Scheme string // "http", "https", or "grpc"
	Host   string
	Port   string
	IsGRPC bool
}

var ErrMissingEnvironment = errors.New("missing required Agent Stub environment variables")

// ReadEnvironment reads and validates the Agent Stub env vars.
func ReadEnvironment() (*Environment, error) {
	apiURL := strings.TrimSpace(os.Getenv(EnvAPIBaseURL))
	authJWE := strings.TrimSpace(os.Getenv(EnvAuthJWE))

	var missing []string
	if apiURL == "" {
		missing = append(missing, EnvAPIBaseURL)
	}
	if authJWE == "" {
		missing = append(missing, EnvAuthJWE)
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("%w: %s", ErrMissingEnvironment, strings.Join(missing, ", "))
	}

	endpoint, err := ParseEndpoint(apiURL)
	if err != nil {
		return nil, fmt.Errorf("invalid %s: %w", EnvAPIBaseURL, err)
	}

	return &Environment{
		URL:     endpoint.URL,
		AuthJWE: authJWE,
	}, nil
}

// HasEnvironment returns whether both required env vars are set.
func HasEnvironment() bool {
	return os.Getenv(EnvAPIBaseURL) != "" && os.Getenv(EnvAuthJWE) != ""
}

// ReadDriveBase returns the configured drive base or the default.
func ReadDriveBase() string {
	if v := strings.TrimSpace(os.Getenv(EnvDriveBase)); v != "" {
		return v
	}
	return DefaultDriveBase
}

// ParseEndpoint parses an Agent Stub URL and normalizes it.
func ParseEndpoint(rawURL string) (*Endpoint, error) {
	stripped := strings.TrimSpace(rawURL)
	if stripped == "" {
		return nil, errors.New("Agent Stub URL must not be empty")
	}

	parsed, err := url.Parse(stripped)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	switch parsed.Scheme {
	case "http", "https":
		return parseHTTPEndpoint(parsed)
	case "grpc":
		return parseGRPCEndpoint(parsed)
	default:
		return nil, errors.New("Agent Stub URL must use http, https, or grpc")
	}
}

func parseHTTPEndpoint(parsed *url.URL) (*Endpoint, error) {
	if parsed.Host == "" {
		return nil, errors.New("Agent Stub URL must include a host")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("Agent Stub URL must not include a query string or fragment")
	}
	if parsed.User != nil {
		return nil, errors.New("Agent Stub URL must not include user info")
	}

	path := strings.TrimRight(parsed.Path, "/")
	if path == "" || path == "/" {
		path = "/agent-stub"
	} else if path != "/agent-stub" {
		return nil, errors.New("HTTP Agent Stub API base URL path must be empty or /agent-stub")
	}

	normalizedURL := fmt.Sprintf("%s://%s%s", parsed.Scheme, parsed.Host, path)
	return &Endpoint{
		URL:    normalizedURL,
		Scheme: parsed.Scheme,
		Host:   parsed.Hostname(),
		Port:   parsed.Port(),
		IsGRPC: false,
	}, nil
}

func parseGRPCEndpoint(parsed *url.URL) (*Endpoint, error) {
	if parsed.Host == "" {
		return nil, errors.New("gRPC Agent Stub URL must include a host")
	}
	path := strings.TrimRight(parsed.Path, "/")
	if path != "" && path != "/" {
		return nil, errors.New("gRPC Agent Stub URL must not include a path")
	}
	port := parsed.Port()
	if port == "" {
		return nil, errors.New("gRPC Agent Stub URL must include an explicit port")
	}

	normalizedURL := fmt.Sprintf("grpc://%s:%s", parsed.Hostname(), port)
	return &Endpoint{
		URL:    normalizedURL,
		Scheme: "grpc",
		Host:   parsed.Hostname(),
		Port:   port,
		IsGRPC: true,
	}, nil
}
