package agentcli

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/klauspost/compress/zstd"
)

func TestHomeSnapshotArchiveRoundTripAndSymlinkRelocation(t *testing.T) {
	source := t.TempDir()
	target := t.TempDir()
	mustMkdirAll(t, filepath.Join(source, "data"))
	mustWriteFile(t, filepath.Join(source, "data", "value.txt"), []byte("checkpoint"))
	mustMkdirAll(t, filepath.Join(source, "workspace"))
	mustWriteFile(t, filepath.Join(source, "workspace", "shared.txt"), []byte("excluded"))
	mustSymlink(t, "data/value.txt", filepath.Join(source, "relative"))
	mustSymlink(t, filepath.Join(source, "data", "value.txt"), filepath.Join(source, "absolute-internal"))
	mustSymlink(t, "/usr/bin/env", filepath.Join(source, "absolute-external"))
	absoluteExternalWithDotDot := source + string(filepath.Separator) + ".." + string(filepath.Separator) + "outside"
	mustSymlink(t, absoluteExternalWithDotDot, filepath.Join(source, "absolute-external-dotdot"))
	mustSymlink(t, filepath.Join(source, "workspace", "shared.txt"), filepath.Join(source, "absolute-excluded"))

	excludes, err := normalizeSnapshotExcludes(source, []string{"workspace"})
	if err != nil {
		t.Fatalf("normalize excludes: %v", err)
	}
	var archive bytes.Buffer
	if err := writeHomeSnapshotArchive(context.Background(), &archive, source, excludes); err != nil {
		t.Fatalf("write archive: %v", err)
	}
	if err := extractHomeSnapshotArchive(bytes.NewReader(archive.Bytes()), target); err != nil {
		t.Fatalf("extract archive: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(target, "data", "value.txt"))
	if err != nil || string(content) != "checkpoint" {
		t.Fatalf("restored content = %q, %v", content, err)
	}
	assertSymlinkTarget(t, filepath.Join(target, "relative"), "data/value.txt")
	assertSymlinkTarget(t, filepath.Join(target, "absolute-internal"), "data/value.txt")
	assertSymlinkTarget(t, filepath.Join(target, "absolute-external"), "/usr/bin/env")
	assertSymlinkTarget(t, filepath.Join(target, "absolute-external-dotdot"), absoluteExternalWithDotDot)
	assertSymlinkTarget(t, filepath.Join(target, "absolute-excluded"), filepath.Join(source, "workspace", "shared.txt"))
	if _, err := os.Lstat(filepath.Join(target, "workspace")); !os.IsNotExist(err) {
		t.Fatalf("excluded workspace was restored: %v", err)
	}
}

func TestNormalizeSnapshotExcludesRejectsUnsafeValues(t *testing.T) {
	home := t.TempDir()
	for _, value := range []string{"", ".", "..", "../outside", "/absolute", "foo/../bar", "foo*", `foo\bar`} {
		t.Run(value, func(t *testing.T) {
			if _, err := normalizeSnapshotExcludes(home, []string{value}); err == nil {
				t.Fatalf("expected exclude %q to fail", value)
			}
		})
	}
}

func TestExtractHomeSnapshotArchiveRejectsUnsafeEntries(t *testing.T) {
	cases := []tar.Header{
		{Name: "/absolute", Typeflag: tar.TypeReg, Mode: 0o600},
		{Name: "../outside", Typeflag: tar.TypeReg, Mode: 0o600},
		{Name: "not/../normalized", Typeflag: tar.TypeReg, Mode: 0o600},
		{Name: "hardlink", Typeflag: tar.TypeLink, Linkname: "target"},
		{Name: "fifo", Typeflag: tar.TypeFifo},
	}
	for _, header := range cases {
		t.Run(header.Name, func(t *testing.T) {
			archive := compressedTar(t, header)
			if err := extractHomeSnapshotArchive(bytes.NewReader(archive), t.TempDir()); err == nil {
				t.Fatalf("expected entry %#v to be rejected", header)
			}
		})
	}
}

func TestExtractHomeSnapshotArchiveRejectsCorruptStream(t *testing.T) {
	if err := extractHomeSnapshotArchive(bytes.NewReader([]byte("not-zstd")), t.TempDir()); err == nil {
		t.Fatal("expected corrupt zstd stream to fail")
	}
}

func TestExtractHomeSnapshotArchiveRejectsTruncatedZstdTail(t *testing.T) {
	archive := compressedTar(t, tar.Header{Name: "file", Typeflag: tar.TypeReg, Mode: 0o600})
	truncated := archive[:len(archive)-1]

	if err := extractHomeSnapshotArchive(bytes.NewReader(truncated), t.TempDir()); err == nil {
		t.Fatal("expected truncated zstd tail to fail")
	}
}

func TestExtractHomeSnapshotArchiveDoesNotRestoreSetIDBits(t *testing.T) {
	target := t.TempDir()
	archive := compressedTar(t, tar.Header{Name: "file", Typeflag: tar.TypeReg, Mode: 0o6755})

	if err := extractHomeSnapshotArchive(bytes.NewReader(archive), target); err != nil {
		t.Fatalf("extract archive: %v", err)
	}
	info, err := os.Stat(filepath.Join(target, "file"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&(os.ModeSetuid|os.ModeSetgid) != 0 {
		t.Fatalf("restored privileged mode bits: %v", info.Mode())
	}
	if info.Mode().Perm() != 0o755 {
		t.Fatalf("restored permissions = %o, want 755", info.Mode().Perm())
	}
}

func TestRunHomeSnapshotUploadRejectsInvalidHome(t *testing.T) {
	homeFile := filepath.Join(t.TempDir(), "not-a-directory")
	mustWriteFile(t, homeFile, []byte("file"))
	for name, home := range map[string]string{
		"empty":        "",
		"relative":     "relative/home",
		"missing":      filepath.Join(t.TempDir(), "missing"),
		"regular-file": homeFile,
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv("HOME", home)
			if err := RunHomeSnapshotUpload(context.Background(), &Environment{}, nil); err == nil {
				t.Fatalf("expected HOME %q to be rejected", home)
			}
		})
	}
}

func TestRunHomeSnapshotDownloadRejectsNonEmptyHome(t *testing.T) {
	home := t.TempDir()
	mustWriteFile(t, filepath.Join(home, "existing"), []byte("keep"))
	t.Setenv("HOME", home)

	if err := RunHomeSnapshotDownload(context.Background(), &Environment{}); err == nil {
		t.Fatal("expected non-empty HOME to be rejected")
	}
	content, err := os.ReadFile(filepath.Join(home, "existing"))
	if err != nil || string(content) != "keep" {
		t.Fatalf("existing HOME content changed: %q, %v", content, err)
	}
}

func TestRunHomeSnapshotUploadAndDownloadStreamThroughExistingStubEnvironment(t *testing.T) {
	source := t.TempDir()
	mustWriteFile(t, filepath.Join(source, "checkpoint.txt"), []byte("streamed"))
	var archive []byte
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/agent-stub/home-snapshots/archive" {
			http.NotFound(response, request)
			return
		}
		if request.Header.Get("Authorization") != "Bearer purpose-token" {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch request.Method {
		case http.MethodPut:
			var err error
			archive, err = io.ReadAll(request.Body)
			if err != nil {
				http.Error(response, err.Error(), http.StatusBadRequest)
				return
			}
			response.WriteHeader(http.StatusNoContent)
		case http.MethodGet:
			_, _ = response.Write(archive)
		default:
			response.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer server.Close()
	env := &Environment{URL: server.URL + "/agent-stub", AuthJWE: "purpose-token"}

	t.Setenv("HOME", source)
	if err := RunHomeSnapshotUpload(context.Background(), env, nil); err != nil {
		t.Fatalf("upload: %v", err)
	}
	if len(archive) == 0 {
		t.Fatal("gateway received no archive bytes")
	}
	sourceContent, err := os.ReadFile(filepath.Join(source, "checkpoint.txt"))
	if err != nil || string(sourceContent) != "streamed" {
		t.Fatalf("upload changed source HOME: %q, %v", sourceContent, err)
	}
	sourceEntries, err := os.ReadDir(source)
	if err != nil || len(sourceEntries) != 1 {
		t.Fatalf("upload left source artifacts: %v, %v", sourceEntries, err)
	}

	target := t.TempDir()
	t.Setenv("HOME", target)
	if err := RunHomeSnapshotDownload(context.Background(), env); err != nil {
		t.Fatalf("download: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(target, "checkpoint.txt"))
	if err != nil || string(content) != "streamed" {
		t.Fatalf("restored content = %q, %v", content, err)
	}
	entries, err := os.ReadDir(target)
	if err != nil || len(entries) != 1 {
		t.Fatalf("target contains unexpected temp artifacts: %v, %v", entries, err)
	}
}

func TestRunHomeSnapshotUploadPropagatesGatewayFailure(t *testing.T) {
	home := t.TempDir()
	mustWriteFile(t, filepath.Join(home, "checkpoint.txt"), []byte(strings.Repeat("x", 1024)))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Error(response, "store unavailable", http.StatusBadGateway)
	}))
	defer server.Close()
	t.Setenv("HOME", home)

	err := RunHomeSnapshotUpload(
		context.Background(),
		&Environment{URL: server.URL + "/agent-stub", AuthJWE: "purpose-token"},
		nil,
	)

	if err == nil || !strings.Contains(err.Error(), "502") {
		t.Fatalf("upload error = %v", err)
	}
}

func TestRunHomeSnapshotUploadEarlyTerminationJoinsProducer(t *testing.T) {
	for _, test := range []struct {
		name          string
		cancelOnStart bool
	}{
		{name: "http-failure"},
		{name: "cancellation", cancelOnStart: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			home := t.TempDir()
			content := make([]byte, 16*1024*1024)
			if _, err := io.ReadFull(rand.Reader, content); err != nil {
				t.Fatal(err)
			}
			mustWriteFile(t, filepath.Join(home, "large.bin"), content)
			t.Setenv("HOME", home)

			requestStarted := make(chan struct{})
			handlerFinished := make(chan struct{})
			releaseHandler := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				defer close(handlerFinished)
				close(requestStarted)
				if test.cancelOnStart {
					select {
					case <-releaseHandler:
					case <-time.After(5 * time.Second):
						http.Error(response, "test handler timed out", http.StatusGatewayTimeout)
					}
					return
				}
				http.Error(response, "early failure", http.StatusBadGateway)
			}))
			defer server.Close()
			handlerReleased := false
			defer func() {
				if !handlerReleased {
					close(releaseHandler)
				}
			}()

			ctx, cancel := context.WithCancel(context.Background())
			uploadAndProducerFinished := make(chan error, 1)
			uploadFinished := false
			go func() {
				uploadAndProducerFinished <- RunHomeSnapshotUpload(
					ctx,
					&Environment{URL: server.URL + "/agent-stub", AuthJWE: "purpose-token"},
					nil,
				)
			}()
			defer func() {
				cancel()
				if !uploadFinished {
					select {
					case <-uploadAndProducerFinished:
					case <-time.After(5 * time.Second):
						t.Errorf("owned upload goroutine did not finish during cleanup")
					}
				}
			}()

			select {
			case <-requestStarted:
			case <-time.After(5 * time.Second):
				t.Fatal("upload request never reached the HTTP handler")
			}
			if test.cancelOnStart {
				cancel()
			}

			var uploadErr error
			select {
			case uploadErr = <-uploadAndProducerFinished:
				uploadFinished = true
			case <-time.After(5 * time.Second):
				t.Fatal("upload and its archive producer did not finish after early termination")
			}
			if uploadErr == nil {
				t.Fatal("expected upload to fail")
			}
			if test.cancelOnStart {
				if !errors.Is(uploadErr, context.Canceled) && !errors.Is(uploadErr, io.ErrClosedPipe) {
					t.Fatalf("canceled upload error = %v", uploadErr)
				}
				close(releaseHandler)
				handlerReleased = true
			} else if !strings.Contains(uploadErr.Error(), "502") {
				t.Fatalf("HTTP failure upload error = %v", uploadErr)
			}

			select {
			case <-handlerFinished:
			case <-time.After(5 * time.Second):
				t.Fatal("HTTP handler did not finish after upload termination")
			}
		})
	}
}

func TestHomeSnapshotTransfersRejectNonSuccessStatuses(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusInternalServerError} {
		for _, operation := range []string{"upload", "download"} {
			t.Run(fmt.Sprintf("%s-%d", operation, status), func(t *testing.T) {
				client := NewHTTPClient(&Environment{URL: "http://agent-stub.invalid", AuthJWE: "purpose-token"})
				client.homeSnapshotClient = httpDoerFunc(func(*http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: status,
						Body:       io.NopCloser(strings.NewReader(`{"detail":"transfer failed"}`)),
					}, nil
				})

				var err error
				switch operation {
				case "upload":
					err = client.uploadHomeSnapshot(context.Background(), strings.NewReader("archive"))
				case "download":
					var body io.ReadCloser
					body, err = client.downloadHomeSnapshot(context.Background())
					if body != nil {
						_ = body.Close()
						t.Fatal("download returned a body for a non-success response")
					}
				default:
					t.Fatalf("unknown operation %q", operation)
				}

				if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("HTTP %d", status)) {
					t.Fatalf("%s error = %v", operation, err)
				}
			})
		}
	}
}

func TestHomeSnapshotTransfersRejectRedirects(t *testing.T) {
	var followedRedirects atomic.Int32
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		followedRedirects.Add(1)
		response.WriteHeader(http.StatusNoContent)
	}))
	defer redirectTarget.Close()

	redirectSource := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, redirectTarget.URL, http.StatusTemporaryRedirect)
	}))
	defer redirectSource.Close()

	client := NewHTTPClient(&Environment{URL: redirectSource.URL, AuthJWE: "purpose-token"})
	tests := []struct {
		name     string
		transfer func() error
	}{
		{
			name: "upload",
			transfer: func() error {
				return client.uploadHomeSnapshot(context.Background(), strings.NewReader("archive"))
			},
		},
		{
			name: "download",
			transfer: func() error {
				body, err := client.downloadHomeSnapshot(context.Background())
				if body != nil {
					_ = body.Close()
				}
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.transfer()
			if err == nil || !strings.Contains(err.Error(), "307") {
				t.Fatalf("%s redirect error = %v", test.name, err)
			}
		})
	}
	if got := followedRedirects.Load(); got != 0 {
		t.Fatalf("Home Snapshot client followed %d redirects", got)
	}
}

func TestRunHomeSnapshotDownloadHonorsContextCancellation(t *testing.T) {
	handlerStarted := make(chan struct{})
	handlerFinished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		defer close(handlerFinished)
		response.WriteHeader(http.StatusOK)
		response.(http.Flusher).Flush()
		close(handlerStarted)
		select {
		case <-request.Context().Done():
		case <-time.After(5 * time.Second):
			http.Error(response, "test handler timed out", http.StatusGatewayTimeout)
		}
	}))
	defer server.Close()
	t.Setenv("HOME", t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	downloadFinished := false
	handlerDone := false
	go func() {
		result <- RunHomeSnapshotDownload(
			ctx,
			&Environment{URL: server.URL + "/agent-stub", AuthJWE: "purpose-token"},
		)
	}()
	defer func() {
		cancel()
		if !downloadFinished {
			select {
			case <-result:
			case <-time.After(5 * time.Second):
				t.Errorf("owned download goroutine did not finish during cleanup")
			}
		}
		if !handlerDone {
			select {
			case <-handlerFinished:
			case <-time.After(5 * time.Second):
				t.Errorf("HTTP handler did not finish during cleanup")
			}
		}
	}()

	select {
	case <-handlerStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("download request never reached the HTTP handler")
	}
	cancel()

	var downloadErr error
	select {
	case downloadErr = <-result:
		downloadFinished = true
	case <-time.After(5 * time.Second):
		t.Fatal("download did not return promptly after cancellation")
	}
	if downloadErr == nil {
		t.Fatal("expected canceled download to fail")
	}
	if !errors.Is(downloadErr, context.Canceled) && !strings.Contains(downloadErr.Error(), context.Canceled.Error()) {
		t.Fatalf("canceled download error = %v", downloadErr)
	}
	select {
	case <-handlerFinished:
		handlerDone = true
	case <-time.After(5 * time.Second):
		t.Fatal("HTTP handler did not finish after download cancellation")
	}
}

func compressedTar(t *testing.T, header tar.Header) []byte {
	t.Helper()
	var output bytes.Buffer
	encoder, err := zstd.NewWriter(&output, zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(1)))
	if err != nil {
		t.Fatal(err)
	}
	writer := tar.NewWriter(encoder)
	if err := writer.WriteHeader(&header); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := encoder.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path string, content []byte) {
	t.Helper()
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustSymlink(t *testing.T, target, path string) {
	t.Helper()
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
}

func assertSymlinkTarget(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.Readlink(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("symlink %s target = %q, want %q", path, got, want)
	}
}

type httpDoerFunc func(request *http.Request) (*http.Response, error)

func (function httpDoerFunc) Do(request *http.Request) (*http.Response, error) {
	return function(request)
}
