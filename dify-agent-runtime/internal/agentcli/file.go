package agentcli

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

// FileUploadResponse is the JSON output for `dify-agent file upload`.
type FileUploadResponse struct {
	TransferMethod    string `json:"transfer_method"`
	Reference         string `json:"reference"`
	PublicDownloadURL string `json:"public_download_url,omitempty"`
}

// FileDownloadResponse is the response from a file download request.
type FileDownloadResponse struct {
	Filename    string `json:"filename"`
	MimeType    string `json:"mime_type,omitempty"`
	Size        int64  `json:"size"`
	DownloadURL string `json:"download_url"`
}

// RunFileUpload executes the `file upload` command.
func RunFileUpload(env *Environment, path string, noDownloadLink bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	return runFileUpload(client, path, noDownloadLink, os.Stdout)
}

type fileUploadClient interface {
	filePublicURLClient
	CreateToolFileUploadURL(ctx context.Context, filename, mimetype string) (string, error)
	UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error)
}

type filePublicURLClient interface {
	CreateFileDownloadURL(
		ctx context.Context,
		transferMethod string,
		reference, url *string,
		forFrontend bool,
	) (*FileDownloadResponse, error)
}

func runFileUpload(client fileUploadClient, path string, noDownloadLink bool, output io.Writer) error {
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

	// Step 1: Request a signed upload URL
	uploadURL, err := client.CreateToolFileUploadURL(ctx, filename, mimetype)
	if err != nil {
		return fmt.Errorf("request file upload URL: %w", err)
	}

	// Step 2: Upload the file to the signed URL (data-plane)
	uploadBody, err := client.UploadFileToURL(uploadURL, absPath, filename, mimetype)
	if err != nil {
		return fmt.Errorf("upload file data: %w", err)
	}

	var uploadResult map[string]any
	if err := json.Unmarshal(uploadBody, &uploadResult); err != nil {
		return fmt.Errorf("parse upload result: %w", err)
	}

	reference, _ := uploadResult["reference"].(string)
	if reference == "" {
		return fmt.Errorf("signed file upload response is missing reference")
	}
	if !isCanonicalDifyFileReference(reference) {
		return fmt.Errorf("signed file upload response has invalid reference")
	}

	result := FileUploadResponse{
		TransferMethod: "tool_file",
		Reference:      reference,
	}
	if !noDownloadLink {
		// Step 3: Request a browser-visible URL unless the caller only needs the
		// canonical ToolFile reference.
		ref := reference
		dlResp, err := client.CreateFileDownloadURL(ctx, "tool_file", &ref, nil, true)
		if err != nil {
			writeFileUploadResponse(output, result)
			return fmt.Errorf(
				"request public download URL: %w; retry without uploading again: dify-agent file public-url %s",
				err,
				shellQuoteArgument(reference),
			)
		}
		if dlResp.DownloadURL == "" {
			writeFileUploadResponse(output, result)
			return fmt.Errorf(
				"public file download response is missing download_url; retry without uploading again: dify-agent file public-url %s",
				shellQuoteArgument(reference),
			)
		}
		result.PublicDownloadURL = dlResp.DownloadURL
	}
	writeFileUploadResponse(output, result)
	return nil
}

// RunFilePublicURL requests a browser-visible URL for an existing ToolFile reference.
func RunFilePublicURL(env *Environment, reference string) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	return runFilePublicURL(client, reference, os.Stdout)
}

func runFilePublicURL(client filePublicURLClient, reference string, output io.Writer) error {
	if reference == "" {
		return fmt.Errorf("file reference must not be empty")
	}
	download, err := client.CreateFileDownloadURL(context.Background(), "tool_file", &reference, nil, true)
	if err != nil {
		return fmt.Errorf("request public download URL: %w", err)
	}
	if download.DownloadURL == "" {
		return fmt.Errorf("public file download response is missing download_url")
	}
	writeFileUploadResponse(output, FileUploadResponse{
		TransferMethod:    "tool_file",
		Reference:         reference,
		PublicDownloadURL: download.DownloadURL,
	})
	return nil
}

func writeFileUploadResponse(output io.Writer, result FileUploadResponse) {
	out, _ := json.Marshal(result)
	_, _ = fmt.Fprintln(output, string(out))
}

func shellQuoteArgument(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func isCanonicalDifyFileReference(reference string) bool {
	encodedPayload, found := strings.CutPrefix(reference, "dify-file-ref:")
	if !found || encodedPayload == "" {
		return false
	}
	payloadJSON, err := base64.URLEncoding.DecodeString(encodedPayload)
	if err != nil {
		return false
	}
	var payload struct {
		RecordID string `json:"record_id"`
	}
	if err := json.Unmarshal(payloadJSON, &payload); err != nil {
		return false
	}
	return payload.RecordID != ""
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
	defer func() { _ = client.Close() }()

	dlResp, err := client.CreateFileDownloadURL(ctx, transferMethod, reference, url, false)
	if err != nil {
		return fmt.Errorf("request file download URL: %w", err)
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
		return fmt.Errorf("download file data: %w", err)
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
