package snapshot

import (
	"archive/tar"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/klauspost/compress/zstd"
)

// SaveHome streams homeDir to dst as tar+zstd in a single pass with no
// intermediate spooling. The runtime's own defaults and the caller's
// gitignore-syntax excludes are skipped; see Excluder.
//
// An excluded directory is not descended into, so — as in git — a pattern
// cannot re-include anything beneath a directory that is already excluded.
//
// Symlinks are archived as symlinks; irregular files (sockets, fifos,
// devices) are skipped as runtime artifacts; ownership is not recorded.
// Callers wrap dst to hash or count the compressed bytes.
func SaveHome(ctx context.Context, dst io.Writer, homeDir string, excludes []string) error {
	excluder := NewExcluder(excludes)
	zw, err := zstd.NewWriter(dst,
		zstd.WithEncoderLevel(zstd.SpeedDefault),
		zstd.WithEncoderConcurrency(1),
	)
	if err != nil {
		return fmt.Errorf("create zstd writer: %w", err)
	}
	tw := tar.NewWriter(zw)

	walkErr := filepath.WalkDir(homeDir, func(p string, d fs.DirEntry, inErr error) error {
		if inErr != nil {
			return inErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(homeDir, p)
		if err != nil {
			return err
		}
		if rel == "." {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		if excluder.Excluded(relSlash, d.IsDir()) {
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
			if linkTarget, err = os.Readlink(p); err != nil {
				return err
			}
		case !info.Mode().IsRegular() && !info.IsDir():
			return nil
		}
		hdr, err := tar.FileInfoHeader(info, linkTarget)
		if err != nil {
			return err
		}
		hdr.Name = relSlash
		if info.IsDir() {
			hdr.Name += "/"
		}
		hdr.Uid, hdr.Gid, hdr.Uname, hdr.Gname = 0, 0, "", ""
		if err := tw.WriteHeader(hdr); err != nil {
			return err
		}
		if info.Mode().IsRegular() {
			f, err := os.Open(p)
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
	if walkErr != nil {
		_ = zw.Close()
		return walkErr
	}
	if err := tw.Close(); err != nil {
		return err
	}
	return zw.Close()
}
