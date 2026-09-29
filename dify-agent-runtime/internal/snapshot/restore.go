package snapshot

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"
	"syscall"

	"github.com/klauspost/compress/zstd"
)

// ErrMalformed marks archives that violate the format or hardening rules.
var ErrMalformed = errors.New("archive malformed")

const maxDecoderWindow = 64 << 20

var environmentalErrnos = []syscall.Errno{
	syscall.ENOSPC, syscall.EDQUOT, syscall.EROFS, syscall.EIO,
	syscall.ENOMEM, syscall.EMFILE, syscall.ENFILE,
	syscall.EACCES, syscall.EPERM,
}

func classifyEntryErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return err
	}
	for _, errno := range environmentalErrnos {
		if errors.Is(err, errno) {
			return err
		}
	}
	return fmt.Errorf("%w: %v", ErrMalformed, err)
}

// RestoreResult reports a completed extraction.
type RestoreResult struct {
	Entries      int
	BytesWritten int64
}

func isPAXSparse(hdr *tar.Header) bool {
	for k := range hdr.PAXRecords {
		if strings.HasPrefix(k, "GNU.sparse.") {
			return true
		}
	}
	return false
}

// RestoreHome extracts a tar+zstd stream into homeDir in a single pass.
// Extraction runs under os.Root: escapes via absolute names, "..", or
// symlinked path components are refused by the kernel (openat2/RESOLVE_BENEATH
// on Linux). Only regular files, directories, symlinks, and hardlinks are
// accepted; hardlink targets must resolve inside the root. The stream is not
// size-limited here.
// A mid-stream failure can leave a partially restored Home; callers own
// cleanup of the surrounding sandbox.
func RestoreHome(ctx context.Context, src io.Reader, homeDir string) (RestoreResult, error) {
	var res RestoreResult
	root, err := os.OpenRoot(homeDir)
	if err != nil {
		return res, err
	}
	defer func() { _ = root.Close() }()

	zr, err := zstd.NewReader(src,
		zstd.WithDecoderConcurrency(1),
		zstd.WithDecoderMaxWindow(maxDecoderWindow),
	)
	if err != nil {
		return res, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	defer zr.Close()

	type dirMode struct {
		name string
		mode fs.FileMode
	}
	var dirModes []dirMode

	tr := tar.NewReader(zr)
	for {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			// Apply deferred directory modes in reverse order
			for i := len(dirModes) - 1; i >= 0; i-- {
				d := dirModes[i]
				if err := classifyEntryErr(root.Chmod(d.name, d.mode)); err != nil {
					return res, err
				}
			}
			return res, nil
		}
		if err != nil {
			if errors.Is(err, os.ErrDeadlineExceeded) {
				return res, err
			}
			return res, fmt.Errorf("%w: %v", ErrMalformed, err)
		}
		name, err := cleanEntryName(hdr.Name)
		if err != nil {
			return res, err
		}
		if name == "" {
			continue // the root entry itself
		}
		if hdr.Typeflag == tar.TypeGNUSparse || isPAXSparse(hdr) {
			return res, fmt.Errorf("%w: sparse entry %q not supported", ErrMalformed, hdr.Name)
		}
		mode := hdr.FileInfo().Mode().Perm()
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := classifyEntryErr(root.MkdirAll(name, 0o700)); err != nil {
				return res, err
			}
			dirModes = append(dirModes, dirMode{name, mode})
		case tar.TypeReg:
			if err := classifyEntryErr(ensureParent(root, name)); err != nil {
				return res, err
			}
			n, err := extractFile(root, name, mode, tr)
			if err != nil {
				return res, classifyEntryErr(err)
			}
			if err := classifyEntryErr(root.Chmod(name, mode)); err != nil {
				return res, err
			}
			res.BytesWritten += n
		case tar.TypeSymlink:
			if err := classifyEntryErr(ensureParent(root, name)); err != nil {
				return res, err
			}
			if err := root.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return res, classifyEntryErr(err)
			}
			if err := classifyEntryErr(root.Symlink(hdr.Linkname, name)); err != nil {
				return res, err
			}
		case tar.TypeLink:
			target, err := cleanEntryName(hdr.Linkname)
			if err != nil || target == "" {
				return res, fmt.Errorf("%w: hardlink target %q", ErrMalformed, hdr.Linkname)
			}
			if err := classifyEntryErr(ensureParent(root, name)); err != nil {
				return res, err
			}
			if err := classifyEntryErr(root.Link(target, name)); err != nil {
				return res, err
			}
		default:
			return res, fmt.Errorf("%w: unsupported entry type %d for %q", ErrMalformed, hdr.Typeflag, hdr.Name)
		}
		res.Entries++
	}
}

func cleanEntryName(name string) (string, error) {
	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("%w: absolute entry name %q", ErrMalformed, name)
	}
	cleaned := path.Clean(name)
	if cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", fmt.Errorf("%w: entry escapes root: %q", ErrMalformed, name)
	}
	if cleaned == "." {
		return "", nil
	}
	return cleaned, nil
}

func ensureParent(root *os.Root, name string) error {
	if parent := path.Dir(name); parent != "." {
		return root.MkdirAll(parent, 0o700)
	}
	return nil
}

func extractFile(root *os.Root, name string, mode fs.FileMode, r io.Reader) (int64, error) {
	f, err := root.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(f, r)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return n, err
}
