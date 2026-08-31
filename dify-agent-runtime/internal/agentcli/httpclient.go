package agentcli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	baseURL         string
	authJWE         string
	client          *http.Client
	openUploadFile  func(string) (io.ReadCloser, error)
	doUploadRequest func(*http.Request) (*http.Response, error)
}

var errUploadRequestAborted = errors.New("upload request aborted")

const (
	agentStubAuthorizationExpiredCode = "agent_stub_authorization_expired"
	defaultUploadRequestTimeout       = 180 * time.Second
)

type agentStubHTTPError struct {
	statusCode int
	code       string
	message    string
}

func (e *agentStubHTTPError) Error() string {
	if e.code == agentStubAuthorizationExpiredCode {
		return fmt.Sprintf(
			"HTTP %d: Agent Stub authorization expired after 5 minutes; the authorization in this process will not refresh automatically; start a new shell tool call and retry the command",
			e.statusCode,
		)
	}
	return fmt.Sprintf("HTTP %d: %s", e.statusCode, e.message)
}

// NewHTTPClient creates a new HTTP client for the Agent Stub API.
func NewHTTPClient(env *Environment) *HTTPClient {
	return &HTTPClient{
		baseURL:         env.URL,
		authJWE:         env.AuthJWE,
		client:          &http.Client{Timeout: 30 * time.Second},
		openUploadFile:  openUploadSource,
		doUploadRequest: doUploadRequest,
	}
}

// NewHTTPClientWithTimeout creates a client with a custom timeout.
func NewHTTPClientWithTimeout(env *Environment, timeout time.Duration) *HTTPClient {
	return &HTTPClient{
		baseURL:         env.URL,
		authJWE:         env.AuthJWE,
		client:          &http.Client{Timeout: timeout},
		openUploadFile:  openUploadSource,
		doUploadRequest: doUploadRequest,
	}
}

func openUploadSource(path string) (io.ReadCloser, error) {
	return os.Open(path)
}

func doUploadRequest(req *http.Request) (*http.Response, error) {
	return (&http.Client{Timeout: defaultUploadRequestTimeout}).Do(req)
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
	defer func() { _ = resp.Body.Close() }()

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
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
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
	defer func() { _ = resp.Body.Close() }()

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
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}
	return respBody, resp.StatusCode, nil
}

// uploadFile uploads a file to a signed URL using multipart form.
func (c *HTTPClient) uploadFile(uploadURL string, filePath string, filename string, mimetype string) ([]byte, error) {
	file, err := c.openUploadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	pipeReader, pipeWriter := io.Pipe()

	req, err := http.NewRequest("POST", uploadURL, pipeReader)
	if err != nil {
		_ = pipeReader.Close()
		_ = pipeWriter.Close()
		_ = file.Close()
		return nil, errors.New("create upload request: invalid signed upload URL")
	}
	multipartWriter := multipart.NewWriter(pipeWriter)
	req.Header.Set("Content-Type", multipartWriter.FormDataContentType())

	writerDone := make(chan error, 1)
	go func() {
		writeErr := writeMultipartFile(multipartWriter, file, filename, mimetype)
		if closeErr := file.Close(); writeErr == nil && closeErr != nil {
			writeErr = fmt.Errorf("close file: %w", closeErr)
		}
		if writeErr != nil {
			_ = pipeWriter.CloseWithError(writeErr)
		} else {
			writeErr = pipeWriter.Close()
		}
		writerDone <- writeErr
	}()

	resp, requestErr := c.doUploadRequest(req)
	_ = pipeReader.CloseWithError(errUploadRequestAborted)

	const maxUploadResponseBytes = 1024 * 1024
	var respBody []byte
	var responseErr error
	if resp != nil {
		defer func() { _ = resp.Body.Close() }()
		respBody, responseErr = io.ReadAll(io.LimitReader(resp.Body, maxUploadResponseBytes+1))
	}

	writerErr := <-writerDone
	if resp != nil && (resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices) {
		if len(respBody) > maxUploadResponseBytes {
			respBody = respBody[:maxUploadResponseBytes]
		}
		return nil, fmt.Errorf("upload failed with status %d: %s", resp.StatusCode, string(respBody))
	}
	if requestErr != nil {
		if writerErr != nil && !isUploadWriterAbort(writerErr) {
			return nil, writerErr
		}
		if errors.Is(requestErr, context.DeadlineExceeded) || os.IsTimeout(requestErr) {
			return nil, errors.New("upload request timed out")
		}
		return nil, errors.New("upload request failed")
	}
	if writerErr != nil && !isUploadWriterAbort(writerErr) {
		return nil, writerErr
	}
	if isUploadWriterAbort(writerErr) {
		return nil, errors.New("upload request completed before multipart body was fully written")
	}
	if responseErr != nil {
		return nil, fmt.Errorf("read upload response: %w", responseErr)
	}
	if len(respBody) > maxUploadResponseBytes {
		return nil, fmt.Errorf("upload response exceeds %d bytes", maxUploadResponseBytes)
	}
	return respBody, nil
}

func isUploadWriterAbort(err error) bool {
	return errors.Is(err, errUploadRequestAborted) || errors.Is(err, io.ErrClosedPipe)
}

func writeMultipartFile(
	writer *multipart.Writer,
	file io.Reader,
	filename string,
	mimetype string,
) (resultErr error) {
	defer func() {
		if closeErr := writer.Close(); resultErr == nil && closeErr != nil {
			resultErr = fmt.Errorf("close multipart writer: %w", closeErr)
		}
	}()

	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, filename))
	h.Set("Content-Type", mimetype)
	part, err := writer.CreatePart(h)
	if err != nil {
		return fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return fmt.Errorf("copy file content: %w", err)
	}
	return nil
}

// downloadFromURL downloads bytes from a signed URL.
func (c *HTTPClient) downloadFromURL(downloadURL string) ([]byte, error) {
	dlClient := &http.Client{Timeout: 120 * time.Second}
	resp, err := dlClient.Get(downloadURL)
	if err != nil {
		return nil, fmt.Errorf("download request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
		return fmt.Errorf("agent stub %s failed (HTTP %d): %v", operation, statusCode, detail.Detail)
	}
	return fmt.Errorf("agent stub %s failed (HTTP %d): %s", operation, statusCode, string(body))
}

// checkAgentStubHTTPError decodes structured errors for Agent-visible
// connect, file, and config commands. Drive retains its legacy error contract.
func checkAgentStubHTTPError(body []byte, statusCode int) error {
	if statusCode < 400 {
		return nil
	}

	message := string(body)
	code := ""
	var response struct {
		Detail json.RawMessage `json:"detail"`
	}
	if json.Unmarshal(body, &response) == nil && len(response.Detail) > 0 {
		var detailMessage string
		if json.Unmarshal(response.Detail, &detailMessage) == nil {
			message = detailMessage
		} else {
			var detail struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			}
			if json.Unmarshal(response.Detail, &detail) == nil {
				code = detail.Code
				if detail.Message != "" {
					message = detail.Message
				} else {
					message = string(response.Detail)
				}
			}
		}
	}
	return &agentStubHTTPError{statusCode: statusCode, code: code, message: message}
}
