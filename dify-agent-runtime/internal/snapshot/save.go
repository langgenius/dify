package snapshot

import (
	"archive/tar"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"syscall"

	"github.com/klauspost/compress/zstd"
)

// SaveHome streams homeDir to dst as tar+zstd in a single pass with no
// intermediate spooling. The runtime's own defaults and the caller's
// gitignore-syntax excludes are skipped; see Excluder.
//
// An excluded directory is not descended into, so — as in git — a pattern
// cannot re-include anything beneath a directory that is already excluded.
//
// Symlinks and same-root hardlinks retain their link type; irregular files (sockets, fifos,
// devices) are skipped as runtime artifacts; ownership is not recorded.
// Callers wrap dst to hash or count the compressed bytes.
func SaveHome(ctx context.Context, dst io.Writer, homeDir string, excludes []string) error {
	excluder := NewExcluder(excludes)
	return saveArchive(dst, func(tw *tar.Writer) error {
		return writeTree(ctx, tw, homeDir, "", excluder, nil)
	})
}

// SaveState archives both writable roots in one stream and skips the runtime's
// configured state directories and the default Home state directory.
func SaveState(ctx context.Context, dst io.Writer, homeDir, workspaceDir string, runtimeDirs ...string) error {
	home, workspace, err := resolveStateLayout(homeDir, workspaceDir, runtimeDirs)
	if err != nil {
		return err
	}
	return saveArchive(dst, func(tw *tar.Writer) error {
		if err := writeTree(ctx, tw, home.dir, homePrefix, nil, home.preserved); err != nil {
			return err
		}
		return writeTree(ctx, tw, workspace.dir, workspacePrefix, nil, workspace.preserved)
	})
}

func saveArchive(dst io.Writer, write func(*tar.Writer) error) error {
	zw, err := zstd.NewWriter(dst,
		zstd.WithEncoderLevel(zstd.SpeedDefault),
		zstd.WithEncoderConcurrency(1),
	)
	if err != nil {
		return fmt.Errorf("create zstd writer: %w", err)
	}
	tw := tar.NewWriter(zw)
	if err := write(tw); err != nil {
		_ = zw.Close()
		return err
	}
	if err := tw.Close(); err != nil {
		_ = zw.Close()
		return err
	}
	return zw.Close()
}

func writeTree(ctx context.Context, tw *tar.Writer, dir, prefix string, excluder *Excluder, preserved protectedPaths) error {
	root, err := os.OpenRoot(dir)
	if err != nil {
		return err
	}
	defer func() { _ = root.Close() }()
	type inode struct{ device, number uint64 }
	hardlinks := make(map[inode]string)
	return fs.WalkDir(root.FS(), ".", func(name string, d fs.DirEntry, inErr error) error {
		if inErr != nil {
			return inErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if name == "." && prefix == "" {
			return nil
		}
		reserved, ancestor := preserved.match(name)
		if (reserved || ancestor) && !d.IsDir() {
			return fmt.Errorf("runtime state path %q must be a directory", name)
		}
		if reserved {
			return fs.SkipDir
		}
		if excluder != nil && excluder.Excluded(name, d.IsDir()) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		var linkTarget string
		switch {
		case info.Mode()&fs.ModeSymlink != 0:
			if linkTarget, err = root.Readlink(name); err != nil {
				return err
			}
		case !info.Mode().IsRegular() && !info.IsDir():
			return nil
		}
		hdr, err := tar.FileInfoHeader(info, linkTarget)
		if err != nil {
			return err
		}
		hdr.Name = path.Join(prefix, name)
		if info.IsDir() {
			hdr.Name += "/"
		}
		if stat, ok := info.Sys().(*syscall.Stat_t); info.Mode().IsRegular() && ok && stat.Nlink > 1 {
			id := inode{uint64(stat.Dev), stat.Ino}
			if first, seen := hardlinks[id]; seen {
				hdr.Typeflag, hdr.Linkname, hdr.Size = tar.TypeLink, first, 0
			} else {
				hardlinks[id] = hdr.Name
			}
		}
		hdr.Uid, hdr.Gid, hdr.Uname, hdr.Gname = 0, 0, "", ""
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if hdr.Typeflag == tar.TypeReg {
			f, err := root.Open(name)
			if err != nil {
				return err
			}
			_, err = io.Copy(tw, f)
			_ = f.Close()
			if err != nil {
				return err
			}
		}
		return nil
	})
}
