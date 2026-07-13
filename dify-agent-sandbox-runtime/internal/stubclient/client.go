// Package stubclient provides a gRPC client for the Dify Agent Stub service.
//
// The Agent Stub service runs on the host (dify-agent backend) and exposes
// Connect, FileUpload, and FileDownload RPCs to sandbox-resident processes.
// This client is used by the dify-agent CLI binary inside the sandbox container.
package stubclient

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	stubv1 "github.com/langgenius/dify/dify-agent-sandbox-runtime/gen/dify/agent/stub/v1"
)

// Client wraps the gRPC AgentStubService client with connection lifecycle management.
type Client struct {
	conn    *grpc.ClientConn
	stub    stubv1.AgentStubServiceClient
	timeout time.Duration
}

// Option configures a Client.
type Option func(*Client)

// WithTimeout sets the default per-call timeout. Default is 30s.
func WithTimeout(d time.Duration) Option {
	return func(c *Client) {
		c.timeout = d
	}
}

// Dial creates a new Client connected to the given target address (host:port).
func Dial(target string, opts ...Option) (*Client, error) {
	c := &Client{timeout: 30 * time.Second}
	for _, o := range opts {
		o(c)
	}

	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("stubclient: dial %s: %w", target, err)
	}
	c.conn = conn
	c.stub = stubv1.NewAgentStubServiceClient(conn)
	return c, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// ConnectResult holds the response from a Connect RPC.
type ConnectResult struct {
	ConnectionID string
	Status       string
}

// Connect establishes a logical connection with the Agent Stub server.
func (c *Client) Connect(ctx context.Context, protocolVersion int32, argv []string, metadataJSON string) (*ConnectResult, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	resp, err := c.stub.Connect(ctx, &stubv1.ConnectRequest{
		ProtocolVersion: protocolVersion,
		Argv:            argv,
		MetadataJson:    metadataJSON,
	})
	if err != nil {
		return nil, fmt.Errorf("stubclient: connect: %w", err)
	}
	return &ConnectResult{
		ConnectionID: resp.GetConnectionId(),
		Status:       resp.GetStatus(),
	}, nil
}

// FileUploadResult holds the response from a CreateFileUploadRequest RPC.
type FileUploadResult struct {
	UploadURL string
}

// CreateFileUpload requests an upload URL from the Agent Stub server.
func (c *Client) CreateFileUpload(ctx context.Context, filename, mimetype string) (*FileUploadResult, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	resp, err := c.stub.CreateFileUploadRequest(ctx, &stubv1.FileUploadRequest{
		Filename: filename,
		Mimetype: mimetype,
	})
	if err != nil {
		return nil, fmt.Errorf("stubclient: file upload: %w", err)
	}
	return &FileUploadResult{
		UploadURL: resp.GetUploadUrl(),
	}, nil
}

// FileDownloadResult holds the response from a CreateFileDownloadRequest RPC.
type FileDownloadResult struct {
	Filename    string
	MimeType    string
	Size        int64
	DownloadURL string
}

// CreateFileDownload requests a download URL from the Agent Stub server.
func (c *Client) CreateFileDownload(ctx context.Context, transferMethod string, reference, url *string, forExternal bool) (*FileDownloadResult, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	fileMapping := &stubv1.FileMapping{
		TransferMethod: transferMethod,
	}
	if reference != nil {
		fileMapping.Reference = reference
	}
	if url != nil {
		fileMapping.Url = url
	}

	resp, err := c.stub.CreateFileDownloadRequest(ctx, &stubv1.FileDownloadRequest{
		File:        fileMapping,
		ForExternal: &forExternal,
	})
	if err != nil {
		return nil, fmt.Errorf("stubclient: file download: %w", err)
	}
	return &FileDownloadResult{
		Filename:    resp.GetFilename(),
		MimeType:    resp.GetMimeType(),
		Size:        resp.GetSize(),
		DownloadURL: resp.GetDownloadUrl(),
	}, nil
}
