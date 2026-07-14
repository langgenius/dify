package agentcli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"time"
)

// HTTPClient wraps HTTP interactions with the Agent Stub server.
type HTTPClient struct {
	baseURL string
	authJWE string
	client  *http.Client
}

// NewHTTPClient creates a new HTTP client for the Agent Stub API.
func NewHTTPClient(env *Environment) *HTTPClient {
	return &HTTPClient{
		baseURL: env.URL,
		authJWE: env.AuthJWE,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// NewHTTPClientWithTimeout creates a client with a custom timeout.
func NewHTTPClientWithTimeout(env *Environment, timeout time.Duration) *HTTPClient {
	return &HTTPClient{
		baseURL: env.URL,
		authJWE: env.AuthJWE,
		client:  &http.Client{Timeout: timeout},
	}
}

// postJSON sends a POST request with JSON body and returns the response body.
func (c *HTTPClient) postJSON(path string, payload any) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.authJWE)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// getJSON sends a GET request and returns the response body.
func (c *HTTPClient) getJSON(path string, params map[string]string) ([]byte, int, error) {
	req, err := http.NewRequest("GET", c.baseURL+path, nil)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.authJWE)

	if len(params) > 0 {
		q := req.URL.Query()
		for k, v := range params {
			q.Set(k, v)
		}
		req.URL.RawQuery = q.Encode()
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// getRaw sends a GET request and returns raw bytes (for binary downloads).
func (c *HTTPClient) getRaw(path string, params map[string]string) ([]byte, int, error) {
	return c.getJSON(path, params)
}

// patchJSON sends a PATCH request with JSON body.
func (c *HTTPClient) patchJSON(path string, payload any) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("PATCH", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.authJWE)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// putJSON sends a PUT request with JSON body.
func (c *HTTPClient) putJSON(path string, payload any) ([]byte, int, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest("PUT", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.authJWE)

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// uploadFile uploads a file to a signed URL using multipart form.
func (c *HTTPClient) uploadFile(uploadURL string, filePath string, filename string, mimetype string) ([]byte, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", mimetype)
	part, err := writer.CreatePart(h)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("copy file content: %w", err)
	}
	writer.Close()

	uploadClient := &http.Client{Timeout: 120 * time.Second}
	req, err := http.NewRequest("POST", uploadURL, &buf)
	if err != nil {
		return nil, fmt.Errorf("create upload request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := uploadClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upload request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read upload response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("upload failed with status %d: %s", resp.StatusCode, string(respBody))
	}
	return respBody, nil
}

// downloadFromURL downloads bytes from a signed URL.
func (c *HTTPClient) downloadFromURL(downloadURL string) ([]byte, error) {
	dlClient := &http.Client{Timeout: 120 * time.Second}
	resp, err := dlClient.Get(downloadURL)
	if err != nil {
		return nil, fmt.Errorf("download request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("download failed with status %d: %s", resp.StatusCode, string(body))
	}
	return io.ReadAll(resp.Body)
}

// checkHTTPError returns a formatted error if status >= 400.
func checkHTTPError(body []byte, statusCode int, operation string) error {
	if statusCode < 400 {
		return nil
	}
	var detail struct {
		Detail any `json:"detail"`
	}
	if json.Unmarshal(body, &detail) == nil && detail.Detail != nil {
		return fmt.Errorf("Agent Stub %s failed (HTTP %d): %v", operation, statusCode, detail.Detail)
	}
	return fmt.Errorf("Agent Stub %s failed (HTTP %d): %s", operation, statusCode, string(body))
}
