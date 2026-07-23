package agentcli

import (
	"context"
	"encoding/json"
	"fmt"
)

// httpStubClient implements StubClient using pure HTTP transport.
type httpStubClient struct {
	http *HTTPClient
}

func newHTTPStubClient(env *Environment) *httpStubClient {
	return &httpStubClient{http: NewHTTPClient(env)}
}

func (c *httpStubClient) Close() error { return nil }

func (c *httpStubClient) Connect(_ context.Context, argv []string, metadataJSON string) (*ConnectResponse, error) {
	var metadata any
	if metadataJSON != "" {
		if err := json.Unmarshal([]byte(metadataJSON), &metadata); err != nil {
			metadata = map[string]any{}
		}
	} else {
		metadata = map[string]any{}
	}

	payload := map[string]any{
		"argv":     argv,
		"metadata": metadata,
	}

	body, statusCode, err := c.http.postJSON("/connections", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "connect"); err != nil {
		return nil, err
	}

	var resp ConnectResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse connect response: %w", err)
	}
	return &resp, nil
}

func (c *httpStubClient) CreateFileUploadURL(_ context.Context, filename, mimetype string) (string, error) {
	payload := map[string]string{
		"filename": filename,
		"mimetype": mimetype,
	}
	body, statusCode, err := c.http.postJSON("/files/upload-request", payload)
	if err != nil {
		return "", err
	}
	if err := checkHTTPError(body, statusCode, "file upload request"); err != nil {
		return "", err
	}

	var resp struct {
		UploadURL string `json:"upload_url"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", fmt.Errorf("parse upload response: %w", err)
	}
	if resp.UploadURL == "" {
		return "", fmt.Errorf("signed file upload response is missing upload_url")
	}
	return resp.UploadURL, nil
}

func (c *httpStubClient) CreateFileDownloadURL(_ context.Context, transferMethod string, reference, url *string, forExternal bool) (*FileDownloadResponse, error) {
	fileMapping := map[string]any{
		"transfer_method": transferMethod,
	}
	if reference != nil {
		fileMapping["reference"] = *reference
	}
	if url != nil {
		fileMapping["url"] = *url
	}

	payload := map[string]any{
		"file":         fileMapping,
		"for_external": forExternal,
	}
	body, statusCode, err := c.http.postJSON("/files/download-request", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "file download request"); err != nil {
		return nil, err
	}

	var resp FileDownloadResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, fmt.Errorf("parse download response: %w", err)
	}
	return &resp, nil
}

func (c *httpStubClient) GetDriveManifest(_ context.Context, prefix string, includeDownloadURL bool) (*DriveManifestResponse, error) {
	params := map[string]string{
		"prefix": prefix,
	}
	if includeDownloadURL {
		params["include_download_url"] = "true"
	} else {
		params["include_download_url"] = "false"
	}

	body, statusCode, err := c.http.getJSON("/drive/manifest", params)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "drive manifest"); err != nil {
		return nil, err
	}

	var manifest DriveManifestResponse
	if err := json.Unmarshal(body, &manifest); err != nil {
		return nil, fmt.Errorf("parse drive manifest: %w", err)
	}
	return &manifest, nil
}

func (c *httpStubClient) CommitDrive(_ context.Context, items []DriveCommitItem) ([]byte, error) {
	payload := map[string]any{
		"items": items,
	}
	body, statusCode, err := c.http.postJSON("/drive/commit", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "drive commit"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) GetConfigManifest(_ context.Context) ([]byte, error) {
	body, statusCode, err := c.http.getJSON("/config/manifest", nil)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config manifest"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) PullConfigSkill(_ context.Context, name string) ([]byte, error) {
	body, statusCode, err := c.http.getRaw(fmt.Sprintf("/config/skills/%s/pull", name), nil)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config skill pull"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) PullConfigFile(_ context.Context, name string) ([]byte, error) {
	body, statusCode, err := c.http.getRaw(fmt.Sprintf("/config/files/%s/pull", name), nil)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config file pull"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) PushConfig(_ context.Context, payload any) ([]byte, error) {
	body, statusCode, err := c.http.postJSON("/config/push", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config push"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) PatchConfigEnv(_ context.Context, envText string) ([]byte, error) {
	payload := map[string]string{"env_text": envText}
	body, statusCode, err := c.http.patchJSON("/config/env", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config env update"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) PutConfigNote(_ context.Context, note string) ([]byte, error) {
	payload := map[string]string{"note": note}
	body, statusCode, err := c.http.putJSON("/config/note", payload)
	if err != nil {
		return nil, err
	}
	if err := checkHTTPError(body, statusCode, "config note update"); err != nil {
		return nil, err
	}
	return body, nil
}

func (c *httpStubClient) UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error) {
	return c.http.uploadFile(uploadURL, filePath, filename, mimetype)
}

func (c *httpStubClient) DownloadFromURL(downloadURL string) ([]byte, error) {
	return c.http.downloadFromURL(downloadURL)
}
