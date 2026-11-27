package snapshot

import (
	"archive/tar"
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRestoreStateRejectsEntriesOutsideTheirArchiveRoot(t *testing.T) {
	cases := map[string]func(*tar.Writer){
		"unknown root": func(tw *tar.Writer) {
			regEntry(tw, "other/file.txt", "data")
		},
		"invalid relative path": func(tw *tar.Writer) {
			regEntry(tw, "workspace/../home/file.txt", "data")
		},
		"cross-root hardlink": func(tw *tar.Writer) {
			regEntry(tw, "home/file.txt", "data")
			_ = tw.WriteHeader(&tar.Header{
				Name: "workspace/link", Linkname: "home/file.txt", Typeflag: tar.TypeLink,
			})
		},
	}
	for name, build := range cases {
		t.Run(name, func(t *testing.T) {
			archive := craftArchive(t, build)
			_, err := RestoreState(t.Context(), bytes.NewReader(archive), t.TempDir(), t.TempDir())
			if !errors.Is(err, ErrMalformed) {
				t.Fatalf("restore error = %v, want ErrMalformed", err)
			}
		})
	}
}

func TestStateRejectsSymlinkInRuntimeStateLayout(t *testing.T) {
	for _, name := range []string{".local", ".local/share", RuntimeStateDir} {
		t.Run(name, func(t *testing.T) {
			home, workspace := t.TempDir(), t.TempDir()
			link := filepath.Join(home, name)
			if err := os.MkdirAll(filepath.Dir(link), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(t.TempDir(), link); err != nil {
				t.Fatal(err)
			}
			var archive bytes.Buffer
			if err := SaveState(t.Context(), &archive, home, workspace); err == nil ||
				!strings.Contains(err.Error(), "must be a directory") {
				t.Fatalf("SaveState error = %v", err)
			}
		})
	}
}

func TestRestoreStateRejectsReplacingRuntimeStateAncestor(t *testing.T) {
	home, workspace := t.TempDir(), t.TempDir()
	archive := craftArchive(t, func(tw *tar.Writer) {
		_ = tw.WriteHeader(&tar.Header{Name: "home/.local", Linkname: "somewhere", Typeflag: tar.TypeSymlink})
	})
	_, err := RestoreState(t.Context(), bytes.NewReader(archive), home, workspace)
	if !errors.Is(err, ErrMalformed) || !strings.Contains(err.Error(), "runtime state ancestor") {
		t.Fatalf("RestoreState error = %v", err)
	}
}

func TestRestoreStateRejectsEntriesAffectingConfiguredState(t *testing.T) {
	tests := []struct {
		name, reason string
		build        func(*tar.Writer)
	}{
		{"direct file", "targets runtime state", func(tw *tar.Writer) {
			regEntry(tw, "workspace/xdg/shellctl/shellctl.db", "old database")
		}},
		{"ancestor", "runtime state ancestor", func(tw *tar.Writer) {
			regEntry(tw, "workspace/xdg", "not a directory")
		}},
		{"hardlink", "hardlink target", func(tw *tar.Writer) {
			_ = tw.WriteHeader(&tar.Header{
				Name: "workspace/alias", Linkname: "workspace/xdg/shellctl/shellctl.db", Typeflag: tar.TypeLink,
			})
		}},
		{"symlink traversal", "traverses symlink", func(tw *tar.Writer) {
			_ = tw.WriteHeader(&tar.Header{Name: "workspace/alias", Linkname: "xdg/shellctl", Typeflag: tar.TypeSymlink})
			regEntry(tw, "workspace/alias/shellctl.db", "old database")
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			home, workspace := t.TempDir(), t.TempDir()
			mount := filepath.Join(t.TempDir(), "workspace")
			if err := os.Symlink(workspace, mount); err != nil {
				t.Fatal(err)
			}
			configured := filepath.Join(mount, "xdg", "shellctl")
			if err := os.MkdirAll(configured, 0o700); err != nil {
				t.Fatal(err)
			}
			db := filepath.Join(configured, "shellctl.db")
			if err := os.WriteFile(db, []byte("live database"), 0o600); err != nil {
				t.Fatal(err)
			}
			archive := craftArchive(t, test.build)
			_, err := RestoreState(t.Context(), bytes.NewReader(archive), home, workspace, configured)
			if !errors.Is(err, ErrMalformed) || !strings.Contains(err.Error(), test.reason) {
				t.Fatalf("RestoreState error = %v, want %q", err, test.reason)
			}
			got, err := os.ReadFile(db)
			if err != nil || string(got) != "live database" {
				t.Fatalf("runtime database = %q, %v", got, err)
			}
		})
	}
}

func TestStateRoundTripPreservesSameRootHardlinks(t *testing.T) {
	home, workspace := t.TempDir(), t.TempDir()
	first := filepath.Join(workspace, "first")
	if err := os.WriteFile(first, []byte("linked data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(first, filepath.Join(workspace, "second")); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err := SaveState(t.Context(), &archive, home, workspace); err != nil {
		t.Fatal(err)
	}
	dst := t.TempDir()
	if _, err := RestoreState(t.Context(), &archive, t.TempDir(), dst); err != nil {
		t.Fatal(err)
	}
	a, err := os.Stat(filepath.Join(dst, "first"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.Stat(filepath.Join(dst, "second"))
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(a, b) {
		t.Fatal("restored paths are separate files")
	}
}
