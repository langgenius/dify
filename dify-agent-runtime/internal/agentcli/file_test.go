package agentcli

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
)

type fakeFileUploadClient struct {
	audience FileURLAudience
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
	audience FileURLAudience,
) (*FileDownloadResponse, error) {
	f.audience = audience
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

	if client.audience != FrontendDisplayFileURL {
		t.Fatalf("download audience = %v, want frontend display", client.audience)
	}
	got := strings.TrimSpace(output.String())
	want := `{"transfer_method":"tool_file","reference":"dify-file-ref:canonical","public_download_url":"/files/tools/report.pdf?sign=2"}`
	if got != want {
		t.Fatalf("output = %s, want %s", got, want)
	}
}
