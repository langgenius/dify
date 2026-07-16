package agentcli

import "context"

// StubClient abstracts Agent Stub control-plane and data-plane operations.
// Business logic depends only on this interface, never on HTTP/gRPC details.
type StubClient interface {
	// Control-plane: available via gRPC or HTTP
	Connect(ctx context.Context, argv []string, metadataJSON string) (*ConnectResponse, error)
	CreateFileUploadURL(ctx context.Context, filename, mimetype string) (string, error)
	CreateFileDownloadURL(ctx context.Context, transferMethod string, reference, url *string, forExternal bool) (*FileDownloadResponse, error)

	// Drive operations (HTTP-only control-plane)
	GetDriveManifest(ctx context.Context, prefix string, includeDownloadURL bool) (*DriveManifestResponse, error)
	CommitDrive(ctx context.Context, items []DriveCommitItem) ([]byte, error)

	// Config operations (HTTP-only control-plane)
	GetConfigManifest(ctx context.Context) ([]byte, error)
	PullConfigSkill(ctx context.Context, name string) ([]byte, error)
	PullConfigFile(ctx context.Context, name string) ([]byte, error)
	PushConfig(ctx context.Context, payload any) ([]byte, error)
	PatchConfigEnv(ctx context.Context, envText string) ([]byte, error)
	PutConfigNote(ctx context.Context, note string) ([]byte, error)

	// Data-plane (always HTTP, signed URLs)
	UploadFileToURL(uploadURL, filePath, filename, mimetype string) ([]byte, error)
	DownloadFromURL(downloadURL string) ([]byte, error)

	Close() error
}

// NewStubClient creates the appropriate client based on the endpoint scheme.
func NewStubClient(env *Environment) (StubClient, error) {
	endpoint, err := ParseEndpoint(env.URL)
	if err != nil {
		return nil, err
	}

	httpClient := newHTTPStubClient(env)

	if endpoint.IsGRPC {
		return newGRPCStubClient(endpoint, httpClient)
	}
	return httpClient, nil
}
