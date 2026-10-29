package agentcli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const fifoTestDeadline = 3 * time.Second

func TestDefaultUploadRequestTimeout(t *testing.T) {
	if defaultUploadRequestTimeout != 180*time.Second {
		t.Fatalf("defaultUploadRequestTimeout = %s, want 180s", defaultUploadRequestTimeout)
	}
}

func receiveWithin[T any](ch <-chan T, timeout time.Duration) (T, bool) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case value := <-ch:
		return value, true
	case <-timer.C:
		var zero T
		return zero, false
	}
}

type multipartWriteRecorder struct {
	headerErr        error
	cleanupErr       error
	source           *terminalRecordingReader
	headerAttempted  bool
	headerFailed     bool
	cleanupAttempted bool
}

func (w *multipartWriteRecorder) Write(p []byte) (int, error) {
	if w.headerFailed || (w.source != nil && w.source.finished) {
		w.cleanupAttempted = true
		if w.cleanupErr != nil {
			return 0, w.cleanupErr
		}
		return len(p), nil
	}
	if !w.headerAttempted {
		w.headerAttempted = true
		if w.headerErr != nil {
			w.headerFailed = true
			return 0, w.headerErr
		}
	}
	return len(p), nil
}

type terminalRecordingReader struct {
	reader      io.Reader
	terminalErr error
	finished    bool
}

func (r *terminalRecordingReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if errors.Is(err, io.EOF) {
		r.finished = true
		if r.terminalErr != nil {
			return n, r.terminalErr
		}
	}
	return n, err
}

type dataThenErrorReader struct {
	data      []byte
	sourceErr error
	delivered bool
}

type closeRecordingBody struct {
	reader io.Reader
	closed bool
}

type gatedUploadSource struct {
	payload     []byte
	started     chan struct{}
	release     chan struct{}
	completed   chan struct{}
	releaseOnce sync.Once
	delivered   bool
	closed      bool
}

func newGatedUploadSource(payload []byte) *gatedUploadSource {
	return &gatedUploadSource{
		payload:   payload,
		started:   make(chan struct{}),
		release:   make(chan struct{}),
		completed: make(chan struct{}),
	}
}

func (s *gatedUploadSource) Read(p []byte) (int, error) {
	if s.delivered {
		return 0, io.EOF
	}
	s.delivered = true
	close(s.started)
	<-s.release
	n := copy(p, s.payload)
	close(s.completed)
	return n, nil
}

func (s *gatedUploadSource) Close() error {
	s.unblock()
	s.closed = true
	return nil
}

func (s *gatedUploadSource) unblock() {
	s.releaseOnce.Do(func() { close(s.release) })
}

type releaseOnReadBody struct {
	reader  io.Reader
	release func()
	closed  bool
}

func (b *releaseOnReadBody) Read(p []byte) (int, error) {
	b.release()
	return b.reader.Read(p)
}

func (b *releaseOnReadBody) Close() error {
	b.release()
	b.closed = true
	return nil
}

func (b *closeRecordingBody) Read(p []byte) (int, error) {
	return b.reader.Read(p)
}

func (b *closeRecordingBody) Close() error {
	b.closed = true
	return nil
}

func (r *dataThenErrorReader) Read(p []byte) (int, error) {
	if r.delivered {
		return 0, r.sourceErr
	}
	r.delivered = true
	return copy(p, r.data), nil
}

func TestUploadFileStreamsMultipartBody(t *testing.T) {
	payload := bytes.Repeat([]byte("streamed-payload-"), 128*1024)
	filePath := filepath.Join(t.TempDir(), "payload.bin")
	if err := os.WriteFile(filePath, payload, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength != -1 {
			t.Errorf("content length = %d, want -1 for streamed request", r.ContentLength)
		}
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, fmt.Sprintf("create multipart reader: %v", err), http.StatusBadRequest)
			return
		}
		part, err := reader.NextPart()
		if err != nil {
			http.Error(w, fmt.Sprintf("read multipart part: %v", err), http.StatusBadRequest)
			return
		}
		defer func() { _ = part.Close() }()
		if part.FormName() != "file" || part.FileName() != "payload.bin" {
			http.Error(w, "unexpected multipart metadata", http.StatusBadRequest)
			return
		}
		if got := part.Header.Get("Content-Type"); got != "application/octet-stream" {
			http.Error(w, "unexpected multipart content type: "+got, http.StatusBadRequest)
			return
		}
		got, err := io.ReadAll(part)
		if err != nil {
			http.Error(w, fmt.Sprintf("read multipart content: %v", err), http.StatusBadRequest)
			return
		}
		if !bytes.Equal(got, payload) {
			http.Error(w, "multipart content mismatch", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"reference":"dify-file-ref:canonical"}`))
	}))
	defer server.Close()

	client := NewHTTPClient(&Environment{})
	body, err := client.uploadFile(server.URL, filePath, "payload.bin", "application/octet-stream")
	if err != nil {
		t.Fatalf("upload file: %v", err)
	}
	if string(body) != `{"reference":"dify-file-ref:canonical"}` {
		t.Fatalf("response body = %s", body)
	}
}

func TestUploadFileStartsRequestBeforeSourceEOF(t *testing.T) {
	if testing.Short() {
		t.Skip("uses a local HTTP server and FIFO coordination")
	}
	mkfifo, err := exec.LookPath("mkfifo")
	if err != nil {
		t.Skip("mkfifo is unavailable")
	}
	fifoPath := filepath.Join(t.TempDir(), "stream.bin")
	if err := exec.Command(mkfifo, "-m", "600", fifoPath).Run(); err != nil {
		t.Fatalf("create FIFO: %v", err)
	}

	requestStarted := make(chan struct{})
	continueSource := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(requestStarted)
		reader, err := r.MultipartReader()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		part, err := reader.NextPart()
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		defer func() { _ = part.Close() }()
		body, err := io.ReadAll(part)
		if err != nil || string(body) != "prefix-suffix" {
			http.Error(w, "unexpected streamed body", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="}`))
	}))
	defer server.Close()

	writerDone := make(chan error, 1)
	go func() {
		file, err := os.OpenFile(fifoPath, os.O_WRONLY, 0)
		if err != nil {
			writerDone <- err
			return
		}
		if _, err = file.WriteString("prefix-"); err == nil {
			<-continueSource
			_, err = file.WriteString("suffix")
		}
		if closeErr := file.Close(); err == nil {
			err = closeErr
		}
		writerDone <- err
	}()

	uploadDone := make(chan error, 1)
	go func() {
		client := NewHTTPClient(&Environment{})
		_, err := client.uploadFile(server.URL, fifoPath, "stream.bin", "application/octet-stream")
		uploadDone <- err
	}()

	releaseSource := sync.OnceFunc(func() { close(continueSource) })
	writerJoined := false
	uploadJoined := false
	defer func() {
		releaseSource()
		server.CloseClientConnections()
		if !writerJoined {
			if err, ok := receiveWithin(writerDone, fifoTestDeadline); !ok {
				t.Errorf("cleanup: FIFO writer did not finish within %s", fifoTestDeadline)
			} else if err != nil {
				t.Errorf("cleanup: FIFO writer failed: %v", err)
			}
		}
		if !uploadJoined {
			if err, ok := receiveWithin(uploadDone, fifoTestDeadline); !ok {
				t.Errorf("cleanup: upload did not finish within %s", fifoTestDeadline)
			} else if err != nil {
				t.Errorf("cleanup: upload failed: %v", err)
			}
		}
	}()

	if _, ok := receiveWithin(requestStarted, fifoTestDeadline); !ok {
		t.Fatalf("HTTP request did not start within %s before the source reached EOF", fifoTestDeadline)
	}
	releaseSource()

	writerErr, ok := receiveWithin(writerDone, fifoTestDeadline)
	if !ok {
		t.Fatalf("FIFO writer did not finish within %s after source release", fifoTestDeadline)
	}
	writerJoined = true
	if writerErr != nil {
		t.Fatalf("write FIFO: %v", writerErr)
	}
	uploadErr, ok := receiveWithin(uploadDone, fifoTestDeadline)
	if !ok {
		t.Fatalf("upload did not finish within %s after source EOF", fifoTestDeadline)
	}
	uploadJoined = true
	if uploadErr != nil {
		t.Fatalf("upload FIFO: %v", uploadErr)
	}
}

func TestUploadFileTransportFailureDoesNotBlockWriter(t *testing.T) {
	const querySecret = "signed-upload-credential"
	uploadURL := "https://upload.example/path?X-Amz-Credential=" + querySecret
	source := &closeRecordingBody{reader: strings.NewReader("payload")}
	client := NewHTTPClient(&Environment{})
	client.openUploadFile = func(string) (io.ReadCloser, error) {
		return source, nil
	}
	requestBodyReady := make(chan io.ReadCloser, 1)
	client.doUploadRequest = func(req *http.Request) (*http.Response, error) {
		requestBodyReady <- req.Body
		return nil, errors.New("deterministic transport failure")
	}

	uploadDone := make(chan error, 1)
	go func() {
		_, err := client.uploadFile(uploadURL, "source-path", "payload.bin", "application/octet-stream")
		uploadDone <- err
	}()

	var requestBody io.ReadCloser
	uploadJoined := false
	defer func() {
		_ = source.Close()
		if requestBody == nil {
			requestBody, _ = receiveWithin(requestBodyReady, fifoTestDeadline)
		}
		if requestBody != nil {
			_ = requestBody.Close()
		}
		if !uploadJoined {
			if _, ok := receiveWithin(uploadDone, fifoTestDeadline); !ok {
				t.Errorf("cleanup: transport-failure upload did not finish within %s", fifoTestDeadline)
			}
		}
	}()

	var ok bool
	requestBody, ok = receiveWithin(requestBodyReady, fifoTestDeadline)
	if !ok {
		t.Fatalf("upload request did not start within %s", fifoTestDeadline)
	}

	err, ok := receiveWithin(uploadDone, fifoTestDeadline)
	if !ok {
		t.Fatalf("transport-failure upload did not finish within %s", fifoTestDeadline)
	}
	uploadJoined = true

	if err == nil || err.Error() != "upload request failed" {
		t.Fatalf("error = %v, want upload request failure", err)
	}
	if !source.closed {
		t.Fatal("source file was not closed after transport failure")
	}
	if strings.Contains(err.Error(), uploadURL) || strings.Contains(err.Error(), querySecret) {
		t.Fatalf("error leaked signed upload URL credentials: %v", err)
	}
}

func TestUploadFileInvalidSignedURLDoesNotLeakCredentials(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "payload.txt")
	if err := os.WriteFile(filePath, []byte("payload"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	const querySecret = "signed-upload-credential"
	uploadURL := "http://example.test/upload?X-Amz-Credential=" + querySecret + "\n"

	client := NewHTTPClient(&Environment{})
	_, err := client.uploadFile(uploadURL, filePath, "payload.txt", "text/plain")
	if err == nil || err.Error() != "create upload request: invalid signed upload URL" {
		t.Fatalf("error = %v, want invalid signed upload URL failure", err)
	}
	if strings.Contains(err.Error(), uploadURL) || strings.Contains(err.Error(), querySecret) {
		t.Fatalf("error leaked signed upload URL credentials: %v", err)
	}
}

func TestUploadFileRejectsOversizedResponse(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "payload.txt")
	if err := os.WriteFile(filePath, []byte("payload"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = w.Write(bytes.Repeat([]byte("x"), 1024*1024+1))
	}))
	defer server.Close()

	client := NewHTTPClient(&Environment{})
	_, err := client.uploadFile(server.URL, filePath, "payload.txt", "text/plain")
	if err == nil || !strings.Contains(err.Error(), "upload response exceeds") {
		t.Fatalf("error = %v, want bounded-response failure", err)
	}
}

func TestCheckAgentStubHTTPErrorParsesSupportedResponseShapes(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantMessage string
	}{
		{
			name:        "string detail",
			body:        `{"detail":"invalid request"}`,
			wantMessage: "invalid request",
		},
		{
			name:        "non JSON body",
			body:        "gateway unavailable",
			wantMessage: "gateway unavailable",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := checkAgentStubHTTPError([]byte(test.body), http.StatusUnauthorized)
			var httpErr *agentStubHTTPError
			if !errors.As(err, &httpErr) {
				t.Fatalf("error = %v, want *agentStubHTTPError", err)
			}
			if httpErr.statusCode != http.StatusUnauthorized || httpErr.code != "" {
				t.Fatalf("parsed error = %#v", httpErr)
			}
			if !strings.Contains(err.Error(), test.wantMessage) {
				t.Fatalf("error = %q, want substring %q", err, test.wantMessage)
			}
		})
	}
}

func TestAgentStubAuthorizationExpiryErrorExplainsHowToRefresh(t *testing.T) {
	err := checkAgentStubHTTPError(
		[]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"expired"}}`),
		http.StatusUnauthorized,
	)
	var httpErr *agentStubHTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("error = %v, want *agentStubHTTPError", err)
	}
	if httpErr.statusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", httpErr.statusCode, http.StatusUnauthorized)
	}
	if httpErr.code != agentStubAuthorizationExpiredCode || httpErr.message != "expired" {
		t.Fatalf("parsed error = %#v", httpErr)
	}

	for _, want := range []string{
		"expired after 5 minutes",
		"will not refresh automatically",
		"start a new shell tool call",
		"retry the command",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want substring %q", err, want)
		}
	}
}

func TestToolFileUploadURLAloneOptsIntoStructuredExpiration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("expose_expiration") != "true" {
			t.Errorf("expose_expiration = %q, want true", r.URL.Query().Get("expose_expiration"))
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"expired"}}`))
	}))
	defer server.Close()

	client := newHTTPStubClient(&Environment{URL: server.URL, AuthJWE: "token"})
	_, toolFileErr := client.CreateToolFileUploadURL(context.Background(), "report.pdf", "application/pdf")

	if toolFileErr == nil || !strings.Contains(toolFileErr.Error(), "start a new shell tool call") {
		t.Fatalf("ToolFile error = %v, want structured expiry guidance", toolFileErr)
	}
}

func TestUploadFileReturnsNonSuccessStatus(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "payload.txt")
	if err := os.WriteFile(filePath, []byte("payload"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		http.Error(w, "too large", http.StatusRequestEntityTooLarge)
	}))
	defer server.Close()

	client := NewHTTPClient(&Environment{})
	_, err := client.uploadFile(server.URL, filePath, "payload.txt", "text/plain")
	if err == nil || !strings.Contains(err.Error(), "upload failed with status 413") {
		t.Fatalf("error = %v, want non-success status", err)
	}
}

func uploadFileWithGatedEarlyResponse(t *testing.T, statusCode int, body string) error {
	t.Helper()
	source := newGatedUploadSource([]byte("payload"))
	responseBody := &releaseOnReadBody{reader: strings.NewReader(body), release: source.unblock}
	requestDone := make(chan error, 1)
	var orderingErr error
	client := NewHTTPClient(&Environment{})
	client.openUploadFile = func(string) (io.ReadCloser, error) {
		return source, nil
	}
	client.doUploadRequest = func(req *http.Request) (*http.Response, error) {
		go func() {
			_, err := io.Copy(io.Discard, req.Body)
			requestDone <- err
		}()
		if _, ok := receiveWithin(source.started, fifoTestDeadline); !ok {
			orderingErr = errors.New("upload source did not start before the early response")
			source.unblock()
			return nil, orderingErr
		}
		select {
		case <-source.completed:
			orderingErr = errors.New("upload source completed before the early response")
			return nil, orderingErr
		default:
		}
		return &http.Response{StatusCode: statusCode, Body: responseBody}, nil
	}

	uploadDone := make(chan error, 1)
	go func() {
		_, err := client.uploadFile("https://upload.example/path", "source-path", "payload.bin", "application/octet-stream")
		uploadDone <- err
	}()
	uploadJoined := false
	requestJoined := false
	defer func() {
		source.unblock()
		if !uploadJoined {
			if _, ok := receiveWithin(uploadDone, fifoTestDeadline); !ok {
				t.Errorf("cleanup: early-response upload did not finish within %s", fifoTestDeadline)
			}
		}
		if !requestJoined {
			if _, ok := receiveWithin(requestDone, fifoTestDeadline); !ok {
				t.Errorf("cleanup: early-response request drain did not finish within %s", fifoTestDeadline)
			}
		}
	}()

	uploadErr, ok := receiveWithin(uploadDone, fifoTestDeadline)
	if !ok {
		t.Fatalf("early-response upload did not finish within %s", fifoTestDeadline)
	}
	uploadJoined = true
	if _, ok := receiveWithin(requestDone, fifoTestDeadline); !ok {
		t.Fatalf("early-response request drain did not finish within %s", fifoTestDeadline)
	}
	requestJoined = true
	if orderingErr != nil {
		t.Fatalf("invalid early-response ordering: %v", orderingErr)
	}
	if _, ok := receiveWithin(source.completed, fifoTestDeadline); !ok {
		t.Fatalf("upload source did not finish within %s after response processing", fifoTestDeadline)
	}
	if !source.closed {
		t.Fatal("upload source was not closed before uploadFile returned")
	}
	if !responseBody.closed {
		t.Fatal("early response body was not closed before uploadFile returned")
	}
	return uploadErr
}

func TestUploadFileReturnsEarlyNonSuccessStatusInsteadOfWriterAbort(t *testing.T) {
	err := uploadFileWithGatedEarlyResponse(
		t,
		http.StatusRequestEntityTooLarge,
		"too large without reading body\n",
	)
	if err == nil || !strings.Contains(err.Error(), "upload failed with status 413: too large without reading body") {
		t.Fatalf("error = %v, want early HTTP 413 response", err)
	}
	if strings.Contains(err.Error(), "upload request aborted") || strings.Contains(err.Error(), "closed pipe") {
		t.Fatalf("error exposed internal multipart abort: %v", err)
	}
}

func TestUploadFileRejectsEarlySuccessBeforeMultipartCompletes(t *testing.T) {
	err := uploadFileWithGatedEarlyResponse(t, http.StatusOK, `{"reference":"incomplete"}`)
	if err == nil || err.Error() != "upload request completed before multipart body was fully written" {
		t.Fatalf("error = %v, want incomplete multipart failure", err)
	}
}

func TestUploadFilePropagatesSourceReadFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_, _ = w.Write([]byte(`{"reference":"unused"}`))
	}))
	defer server.Close()

	client := NewHTTPClient(&Environment{})
	_, err := client.uploadFile(server.URL, t.TempDir(), "directory", "application/octet-stream")
	if err == nil || !strings.Contains(err.Error(), "copy file content") {
		t.Fatalf("error = %v, want source read failure", err)
	}
}

func TestUploadFileClosesResourcesAndJoinsWriterOnResponseOutcomes(t *testing.T) {
	responseReadErr := errors.New("response read failed")
	tests := []struct {
		name           string
		statusCode     int
		responseReader io.Reader
		wantError      string
	}{
		{
			name:           "success",
			statusCode:     http.StatusOK,
			responseReader: strings.NewReader(`{"reference":"dify-file-ref:canonical"}`),
		},
		{
			name:           "non-2xx",
			statusCode:     http.StatusRequestEntityTooLarge,
			responseReader: strings.NewReader("too large"),
			wantError:      "upload failed with status 413",
		},
		{
			name:           "response body read error",
			statusCode:     http.StatusOK,
			responseReader: &dataThenErrorReader{data: []byte("partial"), sourceErr: responseReadErr},
			wantError:      "read upload response: response read failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &closeRecordingBody{reader: strings.NewReader("payload")}
			var responseBody *closeRecordingBody
			client := NewHTTPClient(&Environment{})
			client.openUploadFile = func(path string) (io.ReadCloser, error) {
				if path != "source-path" {
					t.Fatalf("source path = %q", path)
				}
				return source, nil
			}
			client.doUploadRequest = func(req *http.Request) (*http.Response, error) {
				if _, err := io.Copy(io.Discard, req.Body); err != nil {
					t.Fatalf("drain request body: %v", err)
				}
				responseBody = &closeRecordingBody{reader: tt.responseReader}
				return &http.Response{StatusCode: tt.statusCode, Body: responseBody}, nil
			}

			_, err := client.uploadFile("https://upload.example/path", "source-path", "payload.txt", "text/plain")

			if tt.wantError == "" {
				if err != nil {
					t.Fatalf("upload file: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantError)
			}
			if !source.closed {
				t.Fatal("source file was not closed before uploadFile returned")
			}
			if responseBody == nil || !responseBody.closed {
				t.Fatal("response body was not closed before uploadFile returned")
			}
		})
	}
}

func TestWriteMultipartFileAlwaysAttemptsCloseAndPreservesPrimaryError(t *testing.T) {
	t.Run("create part failure", func(t *testing.T) {
		createErr := errors.New("create part failed")
		closeErr := errors.New("close failed")
		destination := &multipartWriteRecorder{headerErr: createErr, cleanupErr: closeErr}
		writer := multipart.NewWriter(destination)

		err := writeMultipartFile(
			writer,
			strings.NewReader("payload"),
			"payload.txt",
			"text/plain",
		)

		if !errors.Is(err, createErr) {
			t.Fatalf("error = %v, want CreatePart failure", err)
		}
		if !destination.headerAttempted || !destination.cleanupAttempted {
			t.Fatal("multipart header and cleanup were not both attempted")
		}
	})

	t.Run("copy failure", func(t *testing.T) {
		sourceErr := errors.New("source read failed")
		closeErr := errors.New("close failed")
		source := &terminalRecordingReader{reader: strings.NewReader("payload"), terminalErr: sourceErr}
		destination := &multipartWriteRecorder{cleanupErr: closeErr, source: source}
		writer := multipart.NewWriter(destination)

		err := writeMultipartFile(
			writer,
			source,
			"payload.txt",
			"text/plain",
		)

		if !errors.Is(err, sourceErr) {
			t.Fatalf("error = %v, want source copy failure", err)
		}
		if !destination.cleanupAttempted {
			t.Fatal("multipart cleanup was not attempted after the source read failure")
		}
	})

	t.Run("close failure", func(t *testing.T) {
		closeErr := errors.New("close failed")
		source := &terminalRecordingReader{reader: strings.NewReader("payload")}
		destination := &multipartWriteRecorder{cleanupErr: closeErr, source: source}
		writer := multipart.NewWriter(destination)

		err := writeMultipartFile(
			writer,
			source,
			"payload.txt",
			"text/plain",
		)

		if !errors.Is(err, closeErr) || !strings.Contains(err.Error(), "close multipart writer") {
			t.Fatalf("error = %v, want multipart Close failure", err)
		}
		if !destination.cleanupAttempted {
			t.Fatal("multipart cleanup was not attempted after source EOF")
		}
	})
}
