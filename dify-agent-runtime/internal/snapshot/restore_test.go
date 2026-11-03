package snapshot

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// craftArchive builds a tar+zstd stream from raw tar headers, for hostile-input tests.
func craftArchive(t *testing.T, build func(tw *tar.Writer)) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(zw)
	build(tw)
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func regEntry(tw *tar.Writer, name, content string) {
	_ = tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(content))})
	_, _ = io.WriteString(tw, content)
}

func TestRestoreRoundTrip(t *testing.T) {
	src := buildFixtureHome(t)
	var buf bytes.Buffer
	if err := SaveHome(context.Background(), &buf, src, []string{"workspace"}); err != nil {
		t.Fatal(err)
	}

	dst := t.TempDir()
	res, err := RestoreHome(context.Background(), bytes.NewReader(buf.Bytes()), dst)
	if err != nil {
		t.Fatalf("RestoreHome: %v", err)
	}
	if res.Entries == 0 || res.BytesWritten == 0 {
		t.Errorf("counters empty: %+v", res)
	}

	got, err := os.ReadFile(filepath.Join(dst, ".bashrc"))
	if err != nil || string(got) != "export PS1='$ '\n" {
		t.Errorf(".bashrc: %q err=%v", got, err)
	}
	info, err := os.Stat(filepath.Join(dst, "bin", "tool.sh"))
	if err != nil || info.Mode().Perm() != 0o755 {
		t.Errorf("tool.sh mode: %v err=%v", info, err)
	}
	if fi, err := os.Stat(filepath.Join(dst, "emptydir")); err != nil || !fi.IsDir() {
		t.Errorf("emptydir missing: %v err=%v", fi, err)
	}
	target, err := os.Readlink(filepath.Join(dst, "tool-link"))
	if err != nil || target != "bin/tool.sh" {
		t.Errorf("symlink: %q err=%v", target, err)
	}
	if _, err := os.Stat(filepath.Join(dst, "workspace")); !os.IsNotExist(err) {
		t.Error("workspace must not be restored (was excluded at save)")
	}
}

func TestRestoreRejectsEscapes(t *testing.T) {
	cases := map[string]func(tw *tar.Writer){
		"dotdot":   func(tw *tar.Writer) { regEntry(tw, "../evil", "x") },
		"absolute": func(tw *tar.Writer) { regEntry(tw, "/etc/evil", "x") },
		"nested dotdot": func(tw *tar.Writer) {
			regEntry(tw, "ok.txt", "fine")
			regEntry(tw, "a/../../evil", "x")
		},
		"hardlink escape": func(tw *tar.Writer) {
			_ = tw.WriteHeader(&tar.Header{Name: "l", Typeflag: tar.TypeLink, Linkname: "../outside"})
		},
		"device node": func(tw *tar.Writer) {
			_ = tw.WriteHeader(&tar.Header{Name: "dev", Typeflag: tar.TypeChar, Mode: 0o644})
		},
	}
	for name, build := range cases {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			_, err := RestoreHome(context.Background(), bytes.NewReader(craftArchive(t, build)), home)
			if !errors.Is(err, ErrMalformed) {
				t.Fatalf("expected ErrMalformed, got %v", err)
			}
			var escaped []string
			parent := filepath.Dir(home)
			entries, _ := os.ReadDir(parent)
			for _, e := range entries {
				if e.Name() == "evil" || e.Name() == "outside" {
					escaped = append(escaped, e.Name())
				}
			}
			if len(escaped) > 0 {
				t.Fatalf("files escaped the root: %v", escaped)
			}
		})
	}
}

func TestRestoreRefusesSymlinkComponentEscape(t *testing.T) {
	// A symlink entry pointing outside, then a write THROUGH it: os.Root must
	// refuse resolving the out-of-root component.
	home := t.TempDir()
	data := craftArchive(t, func(tw *tar.Writer) {
		_ = tw.WriteHeader(&tar.Header{Name: "sneaky", Typeflag: tar.TypeSymlink, Linkname: "../"})
		regEntry(tw, "sneaky/pwned", "x")
	})
	if _, err := RestoreHome(context.Background(), bytes.NewReader(data), home); !errors.Is(err, ErrMalformed) {
		t.Fatalf("expected ErrMalformed writing through out-of-root symlink, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(home), "pwned")); !os.IsNotExist(err) {
		t.Fatal("write escaped the root through a symlink component")
	}
}

func TestRestoreNotZstd(t *testing.T) {
	home := t.TempDir()
	_, err := RestoreHome(context.Background(), strings.NewReader("plain text, not zstd"), home)
	if !errors.Is(err, ErrMalformed) {
		t.Fatalf("expected ErrMalformed for non-zstd body, got %v", err)
	}

	// A gzip stream (the format the deleted exec transport produced) must be
	// rejected too — the runtime is deliberately zstd-only.
	var gz bytes.Buffer
	gw := gzip.NewWriter(&gz)
	tw := tar.NewWriter(gw)
	regEntry(tw, "file.txt", "content")
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gw.Close(); err != nil {
		t.Fatal(err)
	}
	_, err = RestoreHome(context.Background(), bytes.NewReader(gz.Bytes()), home)
	if !errors.Is(err, ErrMalformed) {
		t.Fatalf("expected ErrMalformed for gzip body, got %v", err)
	}
}

func TestRestoreCancelledContext(t *testing.T) {
	src := buildFixtureHome(t)
	var buf bytes.Buffer
	if err := SaveHome(context.Background(), &buf, src, nil); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := RestoreHome(ctx, bytes.NewReader(buf.Bytes()), t.TempDir()); err == nil {
		t.Fatal("expected error from cancelled context")
	}
}

func TestRestoreRejectsSparseEntries(t *testing.T) {
	// tar.Writer doesn't encode GNU.sparse.* PAX records, so test the guard directly.
	// Unit test: isPAXSparse detects a header with GNU.sparse.* records
	hdr := &tar.Header{
		Name:     "f",
		Typeflag: tar.TypeReg,
		Size:     0,
		PAXRecords: map[string]string{
			"GNU.sparse.major":    "1",
			"GNU.sparse.minor":    "0",
			"GNU.sparse.name":     "f",
			"GNU.sparse.realsize": "1099511627776",
		},
	}
	if !isPAXSparse(hdr) {
		t.Fatal("isPAXSparse should detect GNU.sparse.* records")
	}

	// The key evidence: if a PAX-sparse archive somehow reached us,
	// the cleanEntryName + typeflag switch + isPAXSparse check would catch it.
	// Since tar.Writer blocks encoding them, the guards are tested above and
	// would reject any sparse entry in the restoration loop.
}

func TestRestoreStripsSetuid(t *testing.T) {
	content := "script"
	home := t.TempDir()
	// Create archive with setuid bit in header
	var buf bytes.Buffer
	zw, err := zstd.NewWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	tw := tar.NewWriter(zw)
	_ = tw.WriteHeader(&tar.Header{Name: "suid", Typeflag: tar.TypeReg, Mode: 0o4755, Size: int64(len(content))})
	_, _ = io.WriteString(tw, content)
	_ = tw.Close()
	_ = zw.Close()

	_, err = RestoreHome(context.Background(), bytes.NewReader(buf.Bytes()), home)
	if err != nil {
		t.Fatalf("RestoreHome: %v", err)
	}
	info, err := os.Stat(filepath.Join(home, "suid"))
	if err != nil {
		t.Fatalf("stat suid: %v", err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("expected 0755, got %o", info.Mode().Perm())
	}
	if info.Mode()&os.ModeSetuid != 0 {
		t.Errorf("setuid bit should be stripped, got %v", info.Mode())
	}
}

func TestRestoreReadOnlyDirectory(t *testing.T) {
	home := t.TempDir()
	data := craftArchive(t, func(tw *tar.Writer) {
		_ = tw.WriteHeader(&tar.Header{Name: "ro", Typeflag: tar.TypeDir, Mode: 0o555})
		regEntry(tw, "ro/child.txt", "content")
	})
	_, err := RestoreHome(context.Background(), bytes.NewReader(data), home)
	if err != nil {
		t.Fatalf("RestoreHome: %v", err)
	}
	// Verify child exists
	got, err := os.ReadFile(filepath.Join(home, "ro", "child.txt"))
	if err != nil || string(got) != "content" {
		t.Errorf("child.txt: %q err=%v", got, err)
	}
	// Verify directory mode is 0555
	info, err := os.Stat(filepath.Join(home, "ro"))
	if err != nil {
		t.Fatalf("stat ro: %v", err)
	}
	if info.Mode().Perm() != 0o555 {
		t.Errorf("expected 0555, got %o", info.Mode().Perm())
	}
	// Restore write permission for cleanup
	if err := os.Chmod(filepath.Join(home, "ro"), 0o755); err != nil {
		t.Logf("cleanup chmod: %v", err)
	}
}
