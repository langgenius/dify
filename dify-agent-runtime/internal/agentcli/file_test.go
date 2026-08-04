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
	forFrontend bool
}

func (f *fakeFileUploadClient) CreateFileUploadURL(_ context.Context, filename, mimetype string) (string, error) {
	return "https://sandbox-files.example.com/files/upload/for-plugin?sign=1", nil
}

func (f *fakeFileUploadClient) UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error) {
	return []byte(`{"reference":"dify-file-ref:canonical"}`), nil
}

func (f *fakeFileUploadClient) CreateFileDownloadURL(
	_ context.Context,
	_ string,
	_, _ *string,
	forFrontend bool,
) (*FileDownloadResponse, error) {
	f.forFrontend = forFrontend
	return &FileDownloadResponse{
		Filename:    "report.pdf",
		MimeType:    "application/pdf",
		Size:        123,
		DownloadURL: "/files/tools/report.pdf?sign=2",
	}, nil
}

func TestRunFileUploadReturnsFrontendDisplayURL(t *testing.T) {
	filePath := t.TempDir() + "/report.pdf"
	if err := os.WriteFile(filePath, []byte("report"), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	client := &fakeFileUploadClient{}
	var output bytes.Buffer
	if err := runFileUpload(client, filePath, &output); err != nil {
		t.Fatalf("run file upload: %v", err)
	}

	if !client.forFrontend {
		t.Fatal("download request did not select frontend display URL")
	}
	got := strings.TrimSpace(output.String())
	want := `{"transfer_method":"tool_file","reference":"dify-file-ref:canonical","public_download_url":"/files/tools/report.pdf?sign=2"}`
	if got != want {
		t.Fatalf("output = %s, want %s", got, want)
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
