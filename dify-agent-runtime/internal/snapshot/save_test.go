package snapshot

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// buildFixtureHome creates a Home tree exercising files, modes, nesting,
// symlinks, an empty dir, and the excluded runtime state dir.
func buildFixtureHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	mustWrite := func(rel, content string, mode os.FileMode) {
		t.Helper()
		p := filepath.Join(home, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), mode); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite(".bashrc", "export PS1='$ '\n", 0o644)
	mustWrite("bin/tool.sh", "#!/bin/sh\necho hi\n", 0o755)
	mustWrite("workspace/notes.txt", "ordinary home content", 0o644)
	mustWrite(".local/share/shellctl/shellctl.db", "live server state", 0o644)
	mustWrite(".local/bin/agent-tool", "#!/bin/sh\necho tool\n", 0o755)
	if err := os.MkdirAll(filepath.Join(home, "emptydir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("bin/tool.sh", filepath.Join(home, "tool-link")); err != nil {
		t.Fatal(err)
	}
	return home
}

// decodeArchive reads a tar+zstd stream into name -> header/content maps.
func decodeArchive(t *testing.T, data []byte) (map[string]*tar.Header, map[string][]byte) {
	t.Helper()
	zr, err := zstd.NewReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("not a zstd stream: %v", err)
	}
	defer zr.Close()
	headers := map[string]*tar.Header{}
	contents := map[string][]byte{}
	tr := tar.NewReader(zr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return headers, contents
		}
		if err != nil {
			t.Fatalf("tar decode: %v", err)
		}
		headers[hdr.Name] = hdr
		if hdr.Typeflag == tar.TypeReg {
			body, err := io.ReadAll(tr)
			if err != nil {
				t.Fatal(err)
			}
			contents[hdr.Name] = body
		}
	}
}

func TestSaveHomeArchivesTreeWithoutExcludes(t *testing.T) {
	home := buildFixtureHome(t)
	var buf bytes.Buffer
	if err := SaveHome(context.Background(), &buf, home, nil); err != nil {
		t.Fatalf("SaveHome: %v", err)
	}
	headers, contents := decodeArchive(t, buf.Bytes())

	if _, ok := headers["workspace/notes.txt"]; !ok {
		t.Error("a Home directory named workspace is ordinary content and must be archived")
	}
	if _, ok := headers[RuntimeStateDir+"/shellctl.db"]; ok {
		t.Error("runtime state must not be archived")
	}
	if hdr := headers[".local/bin/agent-tool"]; hdr == nil {
		t.Error("user-installed tooling under .local must be archived")
	}
	if got := string(contents[".bashrc"]); got != "export PS1='$ '\n" {
		t.Errorf(".bashrc content = %q", got)
	}
	if hdr := headers["bin/tool.sh"]; hdr == nil || hdr.FileInfo().Mode().Perm() != 0o755 {
		t.Errorf("bin/tool.sh mode not preserved: %+v", hdr)
	}
	if hdr := headers["emptydir/"]; hdr == nil || hdr.Typeflag != tar.TypeDir {
		t.Error("empty dir entry missing")
	}
	link := headers["tool-link"]
	if link == nil || link.Typeflag != tar.TypeSymlink || link.Linkname != "bin/tool.sh" {
		t.Errorf("symlink entry wrong: %+v", link)
	}
	for name, hdr := range headers {
		if hdr.Uid != 0 || hdr.Gid != 0 || hdr.Uname != "" || hdr.Gname != "" {
			t.Errorf("ownership leaked into entry %q", name)
		}
	}
}

func TestSaveHomeSkipsIrregularFiles(t *testing.T) {
	home := buildFixtureHome(t)
	fifo := filepath.Join(home, "pipe")
	if err := mkfifo(fifo); err != nil {
		t.Skipf("cannot create fifo: %v", err)
	}
	var buf bytes.Buffer
	if err := SaveHome(context.Background(), &buf, home, nil); err != nil {
		t.Fatalf("SaveHome with fifo present: %v", err)
	}
	headers, _ := decodeArchive(t, buf.Bytes())
	if _, ok := headers["pipe"]; ok {
		t.Error("fifo must be skipped, not archived")
	}
}

func TestSaveHomeCancelledContext(t *testing.T) {
	home := buildFixtureHome(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var buf bytes.Buffer
	if err := SaveHome(ctx, &buf, home, nil); err == nil {
		t.Fatal("expected error from cancelled context")
	}
}

func TestSaveHomeUnreadableFile(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("running as root: permission checks are bypassed")
	}
	home := buildFixtureHome(t)
	locked := filepath.Join(home, "locked.txt")
	if err := os.WriteFile(locked, []byte("secret"), 0o000); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := SaveHome(context.Background(), &buf, home, nil); err == nil {
		t.Fatal("expected error for unreadable file")
	}
}

// The runtime state dir is not logically part of a Home Snapshot, so no
// configuration may put it into one. Excludes add to that rule; they cannot
// subtract from it.
func TestSaveHomeAlwaysSkipsDefaultExcludes(t *testing.T) {
	for name, excludes := range map[string][]string{
		"nil excludes":       nil,
		"empty excludes":     {},
		"unrelated excludes": {".cache"},
		// A caller must not be able to negotiate a default back in, whether
		// by re-including it outright or by anchoring the attempt.
		"re-inclusion":          {"!" + RuntimeStateDir},
		"anchored re-inclusion": {"!/" + RuntimeStateDir + "/**"},
	} {
		t.Run(name, func(t *testing.T) {
			home := buildFixtureHome(t)
			var buf bytes.Buffer
			if err := SaveHome(context.Background(), &buf, home, excludes); err != nil {
				t.Fatalf("SaveHome: %v", err)
			}
			headers, _ := decodeArchive(t, buf.Bytes())
			for entry := range headers {
				for _, dir := range defaultExcludes {
					if entry == dir+"/" || strings.HasPrefix(entry, dir+"/") {
						t.Errorf("%s entry %q archived", dir, entry)
					}
				}
			}
		})
	}
}

// A nested path that merely repeats a default-exclude name is ordinary Home
// content and must survive.
func TestSaveHomeSkipsOnlyExactDefaultExcludePaths(t *testing.T) {
	for _, dir := range defaultExcludes {
		t.Run(dir, func(t *testing.T) {
			home := buildFixtureHome(t)
			nested := filepath.Join(home, "bin", dir)
			if err := os.MkdirAll(nested, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(nested, "keep.txt"), []byte("keep"), 0o644); err != nil {
				t.Fatal(err)
			}
			var buf bytes.Buffer
			if err := SaveHome(context.Background(), &buf, home, nil); err != nil {
				t.Fatalf("SaveHome: %v", err)
			}
			headers, _ := decodeArchive(t, buf.Bytes())
			want := path.Join("bin", dir, "keep.txt")
			if _, ok := headers[want]; !ok {
				t.Errorf("%s dropped; only the exact %s path is excluded", want, dir)
			}
		})
	}
}
