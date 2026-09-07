// Package agentcli implements the dify-agent CLI that runs inside the sandbox
// container. It communicates with the Agent Stub server on the host via HTTP.
package agentcli

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/envvar"
)

const (
	EnvAPIBaseURL = envvar.EnvAgentStubAPIBaseURL
	EnvAuthJWE    = envvar.EnvAgentStubAuthJWE
)

// Environment holds validated Agent Stub connection parameters.
type Environment struct {
	URL     string
	AuthJWE string
}

// Endpoint represents a normalized HTTP Agent Stub endpoint.
type Endpoint struct {
	URL string
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

// ParseEndpoint parses an Agent Stub URL and normalizes it.
func ParseEndpoint(rawURL string) (*Endpoint, error) {
	stripped := strings.TrimSpace(rawURL)
	if stripped == "" {
		return nil, errors.New("agent stub URL must not be empty")
	}

	parsed, err := url.Parse(stripped)
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, errors.New("agent stub URL must use http or https")
	}
	return parseHTTPEndpoint(parsed)
}

func parseHTTPEndpoint(parsed *url.URL) (*Endpoint, error) {
	if parsed.Host == "" {
		return nil, errors.New("agent stub URL must include a host")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("agent stub URL must not include a query string or fragment")
	}
	if parsed.User != nil {
		return nil, errors.New("agent stub URL must not include user info")
	}

	path := strings.TrimRight(parsed.Path, "/")
	if path == "" || path == "/" {
		path = "/agent-stub"
	} else if path != "/agent-stub" {
		return nil, errors.New("HTTP agent stub API base URL path must be empty or /agent-stub")
	}

	normalizedURL := fmt.Sprintf("%s://%s%s", parsed.Scheme, parsed.Host, path)
	return &Endpoint{
		URL: normalizedURL,
	}, nil
}
