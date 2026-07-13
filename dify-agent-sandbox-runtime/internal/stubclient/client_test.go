package stubclient

import (
	"context"
	"net"
	"testing"

	"google.golang.org/grpc"

	stubv1 "github.com/langgenius/dify/dify-agent-sandbox-runtime/gen/dify/agent/stub/v1"
)

// fakeServer implements the AgentStubService for testing.
type fakeServer struct {
	stubv1.UnimplementedAgentStubServiceServer
}

func (f *fakeServer) Connect(_ context.Context, req *stubv1.ConnectRequest) (*stubv1.ConnectResponse, error) {
	return &stubv1.ConnectResponse{
		ConnectionId: "conn-123",
		Status:       "connected",
	}, nil
}

func (f *fakeServer) CreateFileUploadRequest(_ context.Context, req *stubv1.FileUploadRequest) (*stubv1.FileUploadResponse, error) {
	return &stubv1.FileUploadResponse{
		UploadUrl: "https://upload.example.com/" + req.GetFilename(),
	}, nil
}

func (f *fakeServer) CreateFileDownloadRequest(_ context.Context, req *stubv1.FileDownloadRequest) (*stubv1.FileDownloadResponse, error) {
	return &stubv1.FileDownloadResponse{
		Filename:    "downloaded.txt",
		MimeType:    strPtr("text/plain"),
		Size:        1024,
		DownloadUrl: "https://download.example.com/file",
	}, nil
}

func strPtr(s string) *string { return &s }

func startFakeServer(t *testing.T) string {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	srv := grpc.NewServer()
	stubv1.RegisterAgentStubServiceServer(srv, &fakeServer{})
	go func() { _ = srv.Serve(lis) }()
	t.Cleanup(srv.Stop)
	return lis.Addr().String()
}

func TestConnect(t *testing.T) {
	addr := startFakeServer(t)
	c, err := Dial(addr)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer c.Close()

	result, err := c.Connect(context.Background(), 1, []string{"hello"}, `{"key":"val"}`)
	if err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	if result.ConnectionID != "conn-123" {
		t.Errorf("expected conn-123, got %s", result.ConnectionID)
	}
	if result.Status != "connected" {
		t.Errorf("expected connected, got %s", result.Status)
	}
}

func TestCreateFileUpload(t *testing.T) {
	addr := startFakeServer(t)
	c, err := Dial(addr)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer c.Close()

	result, err := c.CreateFileUpload(context.Background(), "test.txt", "text/plain")
	if err != nil {
		t.Fatalf("CreateFileUpload failed: %v", err)
	}
	if result.UploadURL != "https://upload.example.com/test.txt" {
		t.Errorf("unexpected upload URL: %s", result.UploadURL)
	}
}

func TestCreateFileDownload(t *testing.T) {
	addr := startFakeServer(t)
	c, err := Dial(addr)
	if err != nil {
		t.Fatalf("Dial failed: %v", err)
	}
	defer c.Close()

	ref := "dify-file-ref:abc123"
	result, err := c.CreateFileDownload(context.Background(), "local_file", &ref, nil, false)
	if err != nil {
		t.Fatalf("CreateFileDownload failed: %v", err)
	}
	if result.Filename != "downloaded.txt" {
		t.Errorf("unexpected filename: %s", result.Filename)
	}
	if result.Size != 1024 {
		t.Errorf("unexpected size: %d", result.Size)
	}
	if result.DownloadURL != "https://download.example.com/file" {
		t.Errorf("unexpected download URL: %s", result.DownloadURL)
	}
}
