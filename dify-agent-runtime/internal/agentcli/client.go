package agentcli

import "context"

// StubClient abstracts Agent Stub HTTP control-plane and file data-plane operations.
type StubClient interface {
	// HTTP control-plane
	Connect(ctx context.Context, argv []string, metadataJSON string) (*ConnectResponse, error)
	CreateFileUploadURL(ctx context.Context, filename, mimetype string) (string, error)
	CreateToolFileUploadURL(ctx context.Context, filename, mimetype string) (string, error)
	CreateFileDownloadURL(ctx context.Context, transferMethod string, reference, url *string, forFrontend bool) (*FileDownloadResponse, error)

	// Config operations (HTTP-only control-plane)
	GetConfigManifest(ctx context.Context) ([]byte, error)
	CreateConfigDownloadURL(ctx context.Context, kind, name string) (*FileDownloadResponse, error)
	PushConfig(ctx context.Context, payload any) ([]byte, error)
	PatchConfigEnv(ctx context.Context, envText string) ([]byte, error)
	PutConfigNote(ctx context.Context, note string) ([]byte, error)

	// Data-plane (always HTTP, signed URLs)
	UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error)
	DownloadFromURL(downloadURL string) ([]byte, error)

	Close() error
}

// NewStubClient creates the HTTP Agent Stub client.
func NewStubClient(env *Environment) (StubClient, error) {
	endpoint, err := ParseEndpoint(env.URL)
	if err != nil {
		return nil, err
	}
	normalizedEnv := *env
	normalizedEnv.URL = endpoint.URL
	return newHTTPStubClient(&normalizedEnv), nil
}
