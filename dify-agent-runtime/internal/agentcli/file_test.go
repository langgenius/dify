package agentcli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeFileUploadClient struct {
	forFrontend         bool
	downloadRequestCall int
	downloadMethod      string
	uploadResponse      []byte
	calls               []string
	filename            string
	mimetype            string
	uploadURL           string
	uploadedBytes       []byte
	downloadReference   string
	downloadErr         error
	downloadURL         *string
}

func (f *fakeFileUploadClient) CreateToolFileUploadURL(_ context.Context, filename, mimetype string) (string, error) {
	f.calls = append(f.calls, "upload-request")
	f.filename = filename
	f.mimetype = mimetype
	return "https://sandbox-files.example.com/files/upload/for-plugin?sign=1", nil
}

func (f *fakeFileUploadClient) UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error) {
	f.calls = append(f.calls, "multipart-upload")
	f.uploadURL = uploadURL
	f.filename = filename
	f.mimetype = mimetype
	f.uploadedBytes, _ = os.ReadFile(filePath)
	if f.uploadResponse != nil {
		return f.uploadResponse, nil
	}
	return []byte(`{"reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="}`), nil
}

func (f *fakeFileUploadClient) CreateFileDownloadURL(
	_ context.Context,
	transferMethod string,
	reference, _ *string,
	forFrontend bool,
) (*FileDownloadResponse, error) {
	f.calls = append(f.calls, "download-request")
	f.forFrontend = forFrontend
	f.downloadMethod = transferMethod
	f.downloadRequestCall++
	if reference != nil {
		f.downloadReference = *reference
	}
	if f.downloadErr != nil {
		return nil, f.downloadErr
	}
	downloadURL := "/files/tools/report.pdf?sign=2"
	if f.downloadURL != nil {
		downloadURL = *f.downloadURL
	}
	return &FileDownloadResponse{
		Filename:    "report.pdf",
		MimeType:    "application/pdf",
		Size:        123,
		DownloadURL: downloadURL,
	}, nil
}

func TestRunFileUploadReturnsFrontendDisplayURL(t *testing.T) {
	filePath := t.TempDir() + "/report.pdf"
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	client := &fakeFileUploadClient{}
	var output bytes.Buffer
	if err := runFileUpload(client, filePath, false, &output); err != nil {
		t.Fatalf("run file upload: %v", err)
	}

	if !client.forFrontend {
		t.Fatal("download request did not select frontend display URL")
	}
	if got, want := strings.Join(client.calls, ","), "upload-request,multipart-upload,download-request"; got != want {
		t.Fatalf("call order = %s, want %s", got, want)
	}
	if client.filename != "report.pdf" || client.mimetype != "application/pdf" {
		t.Fatalf("upload metadata = (%q, %q), want report.pdf/application/pdf", client.filename, client.mimetype)
	}
	if client.uploadURL != "https://sandbox-files.example.com/files/upload/for-plugin?sign=1" {
		t.Fatalf("upload URL = %q", client.uploadURL)
	}
	if string(client.uploadedBytes) != "report" {
		t.Fatalf("uploaded bytes = %q, want report", client.uploadedBytes)
	}
	if client.downloadReference != "dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ==" {
		t.Fatalf("download reference = %q", client.downloadReference)
	}
	got := strings.TrimSpace(output.String())
	want := `{"transfer_method":"tool_file","reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ==","public_download_url":"/files/tools/report.pdf?sign=2"}`
	if got != want {
		t.Fatalf("output = %s, want %s", got, want)
	}
}

func TestRunFileUploadWithoutDownloadLinkReturnsOnlyCanonicalMapping(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	client := &fakeFileUploadClient{}
	var output bytes.Buffer
	if err := runFileUpload(client, filePath, true, &output); err != nil {
		t.Fatalf("run file upload: %v", err)
	}

	if client.downloadRequestCall != 0 {
		t.Fatalf("download request calls = %d, want 0", client.downloadRequestCall)
	}
	if got, want := strings.Join(client.calls, ","), "upload-request,multipart-upload"; got != want {
		t.Fatalf("call order = %s, want %s", got, want)
	}
	got := strings.TrimSpace(output.String())
	want := `{"transfer_method":"tool_file","reference":"dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="}`
	if got != want {
		t.Fatalf("output = %s, want %s", got, want)
	}
}

func TestRunFileUploadPreservesReferenceWhenPublicURLRequestFails(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	client := &fakeFileUploadClient{downloadErr: &agentStubHTTPError{
		statusCode: http.StatusUnauthorized,
		code:       agentStubAuthorizationExpiredCode,
		message:    "expired",
	}}
	var output bytes.Buffer
	err := runFileUpload(client, filePath, false, &output)
	if err == nil {
		t.Fatal("run file upload succeeded, want public URL failure")
	}
	const reference = "dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="
	if got, want := strings.TrimSpace(output.String()), `{"transfer_method":"tool_file","reference":"`+reference+`"}`; got != want {
		t.Fatalf("partial output = %s, want %s", got, want)
	}
	for _, want := range []string{
		"request public download URL",
		"expired after 5 minutes",
		"will not refresh automatically",
		"start a new shell tool call",
		"retry the command",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want substring %q", err, want)
		}
	}
	recoveryCommand := "dify-agent file public-url '" + reference + "'"
	if !strings.HasSuffix(err.Error(), "retry without uploading again: "+recoveryCommand) {
		t.Fatalf("error = %q, want exact recovery command %q", err, recoveryCommand)
	}
	if got, want := strings.Join(client.calls, ","), "upload-request,multipart-upload,download-request"; got != want {
		t.Fatalf("call order = %s, want %s", got, want)
	}
}

func TestRunFileUploadPreservesReferenceWhenPublicURLResponseIsIncomplete(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	emptyURL := ""
	client := &fakeFileUploadClient{downloadURL: &emptyURL}
	var output bytes.Buffer
	err := runFileUpload(client, filePath, false, &output)
	if err == nil || !strings.Contains(err.Error(), "missing download_url") {
		t.Fatalf("error = %v, want incomplete public URL response", err)
	}
	if !strings.Contains(output.String(), `"reference":"dify-file-ref:`) {
		t.Fatalf("partial output = %q, want uploaded reference", output.String())
	}
	if !strings.Contains(err.Error(), "dify-agent file public-url") {
		t.Fatalf("error = %q, want recovery command", err)
	}
}

func TestRunFilePublicURLUsesExistingReferenceWithoutUploading(t *testing.T) {
	client := &fakeFileUploadClient{}
	var output bytes.Buffer
	const reference = "dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ=="

	if err := runFilePublicURL(client, reference, &output); err != nil {
		t.Fatalf("run file public URL: %v", err)
	}

	if got, want := strings.Join(client.calls, ","), "download-request"; got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
	if !client.forFrontend || client.downloadMethod != "tool_file" || client.downloadReference != reference {
		t.Fatalf(
			"download request = (method=%q, forFrontend=%t, reference=%q)",
			client.downloadMethod,
			client.forFrontend,
			client.downloadReference,
		)
	}
	want := `{"transfer_method":"tool_file","reference":"` + reference + `","public_download_url":"/files/tools/report.pdf?sign=2"}`
	if got := strings.TrimSpace(output.String()); got != want {
		t.Fatalf("output = %s, want %s", got, want)
	}
}

func TestRunFilePublicURLExplainsExpiredAuthorization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent-stub/files/download-request" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":{"code":"agent_stub_authorization_expired","message":"expired"}}`))
	}))
	defer server.Close()

	err := RunFilePublicURL(
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "token"},
		"dify-file-ref:eyJyZWNvcmRfaWQiOiJ0b29sLTEifQ==",
	)
	if err == nil {
		t.Fatal("RunFilePublicURL succeeded, want expired authorization failure")
	}
	for _, want := range []string{
		"request public download URL",
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

func TestRunFileUploadRejectsNonCanonicalReferenceInBothModes(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	for _, noDownloadLink := range []bool{false, true} {
		client := &fakeFileUploadClient{uploadResponse: []byte(`{"reference":"raw-id"}`)}
		var output bytes.Buffer
		err := runFileUpload(client, filePath, noDownloadLink, &output)
		if err == nil || !strings.Contains(err.Error(), "invalid reference") {
			t.Fatalf("noDownloadLink=%t error = %v, want invalid reference", noDownloadLink, err)
		}
		if client.downloadRequestCall != 0 || output.Len() != 0 {
			t.Fatalf(
				"noDownloadLink=%t download calls = %d, output = %q; want no download or output",
				noDownloadLink,
				client.downloadRequestCall,
				output.String(),
			)
		}
	}
}

func TestRunFileUploadRejectsMissingReferenceInBothModes(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	for _, noDownloadLink := range []bool{false, true} {
		client := &fakeFileUploadClient{uploadResponse: []byte(`{"reference":""}`)}
		var output bytes.Buffer
		err := runFileUpload(client, filePath, noDownloadLink, &output)
		if err == nil || !strings.Contains(err.Error(), "missing reference") {
			t.Fatalf("noDownloadLink=%t error = %v, want missing reference", noDownloadLink, err)
		}
		if client.downloadRequestCall != 0 {
			t.Fatalf("noDownloadLink=%t download request calls = %d, want 0", noDownloadLink, client.downloadRequestCall)
		}
	}
}

func TestRunFileUploadRejectsInvalidUploadResponseBeforeDownloadRequest(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "report.pdf")
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	client := &fakeFileUploadClient{uploadResponse: []byte("not-json")}
	var output bytes.Buffer
	err := runFileUpload(client, filePath, true, &output)
	if err == nil || !strings.Contains(err.Error(), "parse upload result") {
		t.Fatalf("error = %v, want parse upload result failure", err)
	}
	if client.downloadRequestCall != 0 {
		t.Fatalf("download request calls = %d, want 0", client.downloadRequestCall)
	}
}

func TestRunFileDownloadRequestsSandboxURLAndWritesFile(t *testing.T) {
	var requestPayload map[string]json.RawMessage
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/agent-stub/files/download-request":
			if err := json.NewDecoder(r.Body).Decode(&requestPayload); err != nil {
				t.Errorf("decode download request: %v", err)
				http.Error(w, "bad request", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"filename":"report.pdf","mime_type":"application/pdf","size":6,"download_url":"` + server.URL + `/files/report.pdf"}`))
		case "/files/report.pdf":
			_, _ = w.Write([]byte("report"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	targetDir := t.TempDir()
	err := RunFileDownload(
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "test-token"},
		"tool_file",
		"dify-file-ref:canonical",
		targetDir,
	)
	if err != nil {
		t.Fatalf("run file download: %v", err)
	}

	var forFrontend bool
	if err := json.Unmarshal(requestPayload["for_frontend"], &forFrontend); err != nil {
		t.Fatalf("decode for_frontend: %v", err)
	}
	if forFrontend {
		t.Fatal("download request selected a frontend URL")
	}
	data, err := os.ReadFile(filepath.Join(targetDir, "report.pdf"))
	if err != nil {
		t.Fatalf("read downloaded file: %v", err)
	}
	if string(data) != "report" {
		t.Fatalf("downloaded file = %q, want report", data)
	}
}
