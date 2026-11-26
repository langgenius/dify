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

const (
	homePrefix      = "home"
	workspacePrefix = "workspace"
)

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
// Extraction runs under os.Root, which refuses to resolve paths outside its
// directory. Only regular files, directories, symlinks, and hardlinks are
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

	return restoreArchive(ctx, src, func(name string, _ byte) (*os.Root, string, error) {
		rel, err := cleanEntryName(name)
		return root, rel, err
	})
}

type archivePath func(name string, kind byte) (*os.Root, string, error)

type dirMode struct {
	archiveName string
	mode        fs.FileMode
}

func restoreArchive(ctx context.Context, src io.Reader, resolve archivePath) (RestoreResult, error) {
	var res RestoreResult
	zr, err := zstd.NewReader(src,
		zstd.WithDecoderConcurrency(1),
		zstd.WithDecoderMaxWindow(maxDecoderWindow),
	)
	if err != nil {
		return res, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	defer zr.Close()

	var dirModes []dirMode

	tr := tar.NewReader(zr)
	for {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			// Read the rest of the compressed stream, including its checksum.
			if _, err := io.Copy(io.Discard, zr); err != nil {
				return res, classifyEntryErr(err)
			}
			// Apply deferred directory modes in reverse order.
			for i := len(dirModes) - 1; i >= 0; i-- {
				d := dirModes[i]
				root, name, err := resolve(d.archiveName, tar.TypeDir)
				if err != nil {
					return res, err
				}
				if name == "" {
					continue
				}
				if err := classifyEntryErr(chmodDir(root, name, d.mode)); err != nil {
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
		root, name, err := resolve(hdr.Name, hdr.Typeflag)
		if err != nil {
			return res, err
		}
		if name == "" {
			continue // the root entry itself
		}
		n, err := extractEntry(root, name, hdr, tr, resolve, &dirModes)
		if err != nil {
			return res, err
		}
		res.BytesWritten += n
		res.Entries++
	}
}

func extractEntry(root *os.Root, name string, hdr *tar.Header, src io.Reader, resolve archivePath, dirs *[]dirMode) (int64, error) {
	if hdr.Typeflag == tar.TypeGNUSparse || isPAXSparse(hdr) {
		return 0, fmt.Errorf("%w: sparse entry %q not supported", ErrMalformed, hdr.Name)
	}
	if name == "." && hdr.Typeflag != tar.TypeDir {
		return 0, fmt.Errorf("%w: root entry %q is not a directory", ErrMalformed, hdr.Name)
	}
	mode := hdr.FileInfo().Mode().Perm()
	if hdr.Typeflag == tar.TypeDir {
		*dirs = append(*dirs, dirMode{archiveName: hdr.Name, mode: mode})
		return 0, classifyEntryErr(root.MkdirAll(name, 0o700))
	}
	if err := ensureParent(root, name); err != nil {
		return 0, classifyEntryErr(err)
	}
	switch hdr.Typeflag {
	case tar.TypeReg:
		n, err := extractFile(root, name, mode, src)
		return n, classifyEntryErr(err)
	case tar.TypeSymlink:
		if err := root.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return 0, classifyEntryErr(err)
		}
		return 0, classifyEntryErr(root.Symlink(hdr.Linkname, name))
	case tar.TypeLink:
		targetRoot, target, err := resolve(hdr.Linkname, tar.TypeReg)
		if err != nil || targetRoot != root || target == "" || target == "." || target == name {
			return 0, fmt.Errorf("%w: hardlink target %q", ErrMalformed, hdr.Linkname)
		}
		if err := root.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return 0, classifyEntryErr(err)
		}
		return 0, classifyEntryErr(root.Link(target, name))
	default:
		return 0, fmt.Errorf("%w: unsupported entry type %d for %q", ErrMalformed, hdr.Typeflag, hdr.Name)
	}
}

func chmodDir(root *os.Root, name string, mode fs.FileMode) error {
	f, err := root.Open(name)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return f.Chmod(mode)
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
	if err == nil {
		err = f.Chmod(mode)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return n, err
}
