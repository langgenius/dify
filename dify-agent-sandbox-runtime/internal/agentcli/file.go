package agentcli

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

// FileUploadResponse is the JSON output for `dify-agent file upload`.
type FileUploadResponse struct {
	TransferMethod string `json:"transfer_method"`
	Reference      string `json:"reference"`
	DownloadURL    string `json:"download_url"`
}

// FileDownloadResponse is the response from a file download request.
type FileDownloadResponse struct {
	Filename    string `json:"filename"`
	MimeType    string `json:"mime_type,omitempty"`
	Size        int64  `json:"size"`
	DownloadURL string `json:"download_url"`
}

// RunFileUpload executes the `file upload` command.
func RunFileUpload(env *Environment, path string) error {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}
	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		return fmt.Errorf("local file not found: %s", absPath)
	}

	filename := filepath.Base(absPath)
	mimetype := guessMIMEType(filename)
	ctx := context.Background()

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	// Step 1: Request a signed upload URL
	uploadURL, err := client.CreateFileUploadURL(ctx, filename, mimetype)
	if err != nil {
		return err
	}

	// Step 2: Upload the file to the signed URL (data-plane)
	uploadBody, err := client.UploadFileToURL(uploadURL, absPath, filename, mimetype)
	if err != nil {
		return err
	}

	var uploadResult map[string]any
	if err := json.Unmarshal(uploadBody, &uploadResult); err != nil {
		return fmt.Errorf("parse upload result: %w", err)
	}

	reference, _ := uploadResult["reference"].(string)
	if reference == "" {
		return fmt.Errorf("signed file upload response is missing reference")
	}

	// Step 3: Request download URL for the uploaded file
	ref := reference
	dlResp, err := client.CreateFileDownloadURL(ctx, "tool_file", &ref, nil, false)
	if err != nil {
		return err
	}

	result := FileUploadResponse{
		TransferMethod: "tool_file",
		Reference:      reference,
		DownloadURL:    dlResp.DownloadURL,
	}
	out, _ := json.Marshal(result)
	fmt.Println(string(out))
	return nil
}

// RunFileDownload executes the `file download` command.
func RunFileDownload(env *Environment, transferMethod string, referenceOrURL string, localDir string) error {
	var reference *string
	var url *string
	if transferMethod == "remote_url" {
		url = &referenceOrURL
	} else {
		reference = &referenceOrURL
	}

	ctx := context.Background()
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	dlResp, err := client.CreateFileDownloadURL(ctx, transferMethod, reference, url, false)
	if err != nil {
		return err
	}
	if dlResp.DownloadURL == "" {
		return fmt.Errorf("signed file download response is missing download_url")
	}
	if dlResp.Filename == "" {
		return fmt.Errorf("signed file download response is missing filename")
	}

	// Download the file (data-plane)
	data, err := client.DownloadFromURL(dlResp.DownloadURL)
	if err != nil {
		return err
	}

	// Determine target directory
	targetDir := localDir
	if targetDir == "" {
		targetDir, _ = os.Getwd()
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create target directory: %w", err)
	}

	// Write file
	sanitizedName := sanitizeFilename(dlResp.Filename)
	destPath := deduplicatePath(filepath.Join(targetDir, sanitizedName))
	if err := os.WriteFile(destPath, data, 0o644); err != nil {
		return fmt.Errorf("write file: %w", err)
	}

	fmt.Println(destPath)
	return nil
}

func guessMIMEType(filename string) string {
	ext := filepath.Ext(filename)
	if ext == "" {
		return "application/octet-stream"
	}
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		return "application/octet-stream"
	}
	// Strip parameters (e.g. "; charset=utf-8") so the MIME type matches
	// what Flask/Werkzeug returns via file.mimetype during signature
	// verification on the Dify API upload endpoint.
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	return mimeType
}

func sanitizeFilename(filename string) string {
	name := filepath.Base(filename)
	if name == "" || name == "." || name == ".." {
		return "downloaded"
	}
	return name
}

func deduplicatePath(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(filepath.Base(path), ext)
	dir := filepath.Dir(path)
	for counter := 1; ; counter++ {
		candidate := filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, counter, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
}
