package agentcli

import (
	"archive/tar"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

const homeSnapshotCopyBufferSize = 1024 * 1024

// RunHomeSnapshotUpload streams a tar.zst representation of $HOME to the
// purpose-scoped Agent Stub gateway.
func RunHomeSnapshotUpload(ctx context.Context, env *Environment, excludes []string) error {
	home, err := snapshotHome()
	if err != nil {
		return err
	}
	normalizedExcludes, err := normalizeSnapshotExcludes(home, excludes)
	if err != nil {
		return err
	}
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	reader, writer := io.Pipe()
	producerDone := make(chan error, 1)
	go func() {
		producerErr := writeHomeSnapshotArchive(ctx, writer, home, normalizedExcludes)
		_ = writer.CloseWithError(producerErr)
		producerDone <- producerErr
	}()

	uploadErr := client.UploadHomeSnapshot(ctx, reader)
	if uploadErr != nil {
		_ = reader.CloseWithError(uploadErr)
	} else {
		_ = reader.Close()
	}
	producerErr := <-producerDone
	if uploadErr != nil {
		return uploadErr
	}
	if producerErr != nil {
		return producerErr
	}
	return nil
}

// RunHomeSnapshotDownload restores one gateway archive into an existing empty
// $HOME. The backend owns cleanup if any validation or write fails.
func RunHomeSnapshotDownload(ctx context.Context, env *Environment) error {
	home, err := snapshotHome()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(home)
	if err != nil {
		return fmt.Errorf("read HOME: %w", err)
	}
	if len(entries) != 0 {
		return errors.New("HOME must be empty before Home Snapshot download")
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	body, err := client.DownloadHomeSnapshot(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = body.Close() }()
	return extractHomeSnapshotArchive(body, home)
}

func snapshotHome() (string, error) {
	home := strings.TrimSpace(os.Getenv("HOME"))
	if home == "" {
		return "", errors.New("HOME must be set")
	}
	if !filepath.IsAbs(home) {
		return "", errors.New("HOME must be an absolute path")
	}
	home = filepath.Clean(home)
	info, err := os.Stat(home)
	if err != nil {
		return "", fmt.Errorf("stat HOME: %w", err)
	}
	if !info.IsDir() {
		return "", errors.New("HOME must be a directory")
	}
	return home, nil
}

func normalizeSnapshotExcludes(home string, excludes []string) (map[string]struct{}, error) {
	normalized := make(map[string]struct{}, len(excludes))
	for _, excluded := range excludes {
		if excluded == "" || filepath.IsAbs(excluded) || strings.Contains(excluded, "\\") {
			return nil, fmt.Errorf("invalid Home Snapshot exclude %q", excluded)
		}
		if strings.ContainsAny(excluded, "*?[") {
			return nil, fmt.Errorf("Home Snapshot exclude must not be a glob: %q", excluded)
		}
		cleaned := filepath.Clean(excluded)
		if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
			return nil, fmt.Errorf("invalid Home Snapshot exclude %q", excluded)
		}
		if cleaned != excluded {
			return nil, fmt.Errorf("Home Snapshot exclude must be normalized: %q", excluded)
		}
		candidate := filepath.Join(home, cleaned)
		relative, err := filepath.Rel(home, candidate)
		if err != nil || relative != cleaned {
			return nil, fmt.Errorf("Home Snapshot exclude escapes HOME: %q", excluded)
		}
		normalized[filepath.ToSlash(cleaned)] = struct{}{}
	}
	return normalized, nil
}

func writeHomeSnapshotArchive(
	ctx context.Context,
	destination io.Writer,
	home string,
	excludes map[string]struct{},
) (retErr error) {
	encoder, err := zstd.NewWriter(
		destination,
		zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(1)),
	)
	if err != nil {
		return fmt.Errorf("create zstd encoder: %w", err)
	}
	tarWriter := tar.NewWriter(encoder)
	defer func() {
		if err := tarWriter.Close(); retErr == nil && err != nil {
			retErr = fmt.Errorf("close tar archive: %w", err)
		}
		if err := encoder.Close(); retErr == nil && err != nil {
			retErr = fmt.Errorf("close zstd archive: %w", err)
		}
	}()

	copyBuffer := make([]byte, homeSnapshotCopyBufferSize)
	err = filepath.WalkDir(home, func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if filePath == home {
			return nil
		}
		relative, err := filepath.Rel(home, filePath)
		if err != nil {
			return err
		}
		entryName := filepath.ToSlash(relative)
		if isSnapshotExcluded(entryName, excludes) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		mode := info.Mode()
		if !mode.IsRegular() && !mode.IsDir() && mode&os.ModeSymlink == 0 {
			return nil
		}

		linkTarget := ""
		if mode&os.ModeSymlink != 0 {
			linkTarget, err = os.Readlink(filePath)
			if err != nil {
				return err
			}
			linkTarget = relocatableSymlinkTarget(home, filePath, linkTarget, excludes)
		}
		header, err := tar.FileInfoHeader(info, linkTarget)
		if err != nil {
			return err
		}
		header.Name = entryName
		header.Uid = 0
		header.Gid = 0
		header.Uname = ""
		header.Gname = ""
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}
		if !mode.IsRegular() {
			return nil
		}
		file, err := os.Open(filePath)
		if err != nil {
			return err
		}
		_, copyErr := io.CopyBuffer(tarWriter, &contextReader{ctx: ctx, reader: file}, copyBuffer)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
	if err != nil {
		return fmt.Errorf("pack HOME: %w", err)
	}
	return nil
}

func relocatableSymlinkTarget(
	home string,
	linkPath string,
	target string,
	excludes map[string]struct{},
) string {
	if !filepath.IsAbs(target) {
		return target
	}
	originalTarget := target
	cleanedTarget := filepath.Clean(target)
	relative, err := filepath.Rel(home, cleanedTarget)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return originalTarget
	}
	if isSnapshotExcluded(filepath.ToSlash(relative), excludes) {
		return originalTarget
	}
	relocated, err := filepath.Rel(filepath.Dir(linkPath), cleanedTarget)
	if err != nil {
		return originalTarget
	}
	return filepath.ToSlash(relocated)
}

func isSnapshotExcluded(entryName string, excludes map[string]struct{}) bool {
	for excluded := range excludes {
		if entryName == excluded || strings.HasPrefix(entryName, excluded+"/") {
			return true
		}
	}
	return false
}

func extractHomeSnapshotArchive(source io.Reader, home string) error {
	decoder, err := zstd.NewReader(source)
	if err != nil {
		return fmt.Errorf("create zstd decoder: %w", err)
	}
	defer decoder.Close()
	tarReader := tar.NewReader(decoder)
	copyBuffer := make([]byte, homeSnapshotCopyBufferSize)
	seen := map[string]struct{}{}
	type directoryMode struct {
		path string
		mode os.FileMode
	}
	var directoryModes []directoryMode

	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar archive: %w", err)
		}
		entryName, err := normalizedArchiveEntryName(header)
		if err != nil {
			return err
		}
		if _, duplicate := seen[entryName]; duplicate {
			return fmt.Errorf("duplicate Home Snapshot entry %q", header.Name)
		}
		seen[entryName] = struct{}{}
		destination := filepath.Join(home, filepath.FromSlash(entryName))
		relative, err := filepath.Rel(home, destination)
		if err != nil || filepath.ToSlash(relative) != entryName {
			return fmt.Errorf("Home Snapshot entry escapes HOME: %q", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(destination, 0o700); err != nil {
				return err
			}
			directoryModes = append(directoryModes, directoryMode{
				path: destination,
				mode: os.FileMode(header.Mode) & os.ModePerm,
			})
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyBuffer(file, tarReader, copyBuffer)
			chmodErr := file.Chmod(os.FileMode(header.Mode) & os.ModePerm)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if chmodErr != nil {
				return chmodErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
				return err
			}
			if err := os.Symlink(header.Linkname, destination); err != nil {
				return err
			}
		case tar.TypeLink:
			return fmt.Errorf("Home Snapshot hardlink entry is not allowed: %q", header.Name)
		default:
			return fmt.Errorf("Home Snapshot special entry is not allowed: %q", header.Name)
		}
	}

	if _, err := io.CopyBuffer(io.Discard, decoder, copyBuffer); err != nil {
		return fmt.Errorf("finish zstd archive: %w", err)
	}
	for index := len(directoryModes) - 1; index >= 0; index-- {
		if err := os.Chmod(directoryModes[index].path, directoryModes[index].mode); err != nil {
			return err
		}
	}
	return nil
}

func normalizedArchiveEntryName(header *tar.Header) (string, error) {
	name := header.Name
	if header.Typeflag == tar.TypeDir {
		name = strings.TrimSuffix(name, "/")
	}
	if name == "" || strings.Contains(name, "\\") || pathpkg.IsAbs(name) {
		return "", fmt.Errorf("invalid Home Snapshot entry path %q", header.Name)
	}
	cleaned := pathpkg.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") || cleaned != name {
		return "", fmt.Errorf("invalid Home Snapshot entry path %q", header.Name)
	}
	return cleaned, nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(buffer []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(buffer)
	}
}
