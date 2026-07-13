package agentcli

import (
	"context"
	"fmt"

	"github.com/langgenius/dify/dify-agent-sandbox-runtime/internal/stubclient"
)

// grpcStubClient implements StubClient with gRPC for Connect/FileUpload/FileDownload
// and delegates all other operations to the embedded HTTP client.
type grpcStubClient struct {
	*httpStubClient
	grpc *stubclient.Client
}

func newGRPCStubClient(endpoint *Endpoint, httpClient *httpStubClient) (*grpcStubClient, error) {
	target := endpoint.Host + ":" + endpoint.Port
	client, err := stubclient.Dial(target)
	if err != nil {
		return nil, fmt.Errorf("gRPC dial %s: %w", target, err)
	}
	return &grpcStubClient{
		httpStubClient: httpClient,
		grpc:           client,
	}, nil
}

func (c *grpcStubClient) Close() error {
	return c.grpc.Close()
}

func (c *grpcStubClient) Connect(ctx context.Context, argv []string, metadataJSON string) (*ConnectResponse, error) {
	if metadataJSON == "" {
		metadataJSON = "{}"
	}
	result, err := c.grpc.Connect(ctx, agentStubProtocolVersion, argv, metadataJSON)
	if err != nil {
		return nil, err
	}
	return &ConnectResponse{
		ConnectionID: result.ConnectionID,
		Status:       result.Status,
	}, nil
}

func (c *grpcStubClient) CreateFileUploadURL(ctx context.Context, filename, mimetype string) (string, error) {
	result, err := c.grpc.CreateFileUpload(ctx, filename, mimetype)
	if err != nil {
		return "", err
	}
	if result.UploadURL == "" {
		return "", fmt.Errorf("signed file upload response is missing upload_url")
	}
	return result.UploadURL, nil
}

func (c *grpcStubClient) CreateFileDownloadURL(ctx context.Context, transferMethod string, reference, url *string, forExternal bool) (*FileDownloadResponse, error) {
	result, err := c.grpc.CreateFileDownload(ctx, transferMethod, reference, url, forExternal)
	if err != nil {
		return nil, err
	}
	return &FileDownloadResponse{
		Filename:    result.Filename,
		MimeType:    result.MimeType,
		Size:        result.Size,
		DownloadURL: result.DownloadURL,
	}, nil
}
