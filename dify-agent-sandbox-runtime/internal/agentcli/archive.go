package agentcli

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// createZipArchive creates a zip file at archivePath containing all files in dirPath,
// excluding common transient directories and files.
func createZipArchive(archivePath string, dirPath string) error {
	outFile, err := os.Create(archivePath)
	if err != nil {
		return fmt.Errorf("create archive file: %w", err)
	}
	defer outFile.Close()

	writer := zip.NewWriter(outFile)
	defer writer.Close()

	skipFiles := map[string]bool{".DS_Store": true, ".DIFY-SKILL-FULL.zip": true}

	return filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			if shouldSkipDir(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}

		if skipFiles[info.Name()] {
			return nil
		}

		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("archive does not support symlinked files: %s", path)
		}

		relPath, err := filepath.Rel(dirPath, path)
		if err != nil {
			return err
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relPath)
		header.Method = zip.Deflate

		w, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()

		_, err = io.Copy(w, file)
		return err
	})
}

// extractZip extracts a zip archive into targetDir with path safety checks.
func extractZip(archivePath string, targetDir string) error {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer r.Close()

	absTarget, err := filepath.Abs(targetDir)
	if err != nil {
		return err
	}

	for _, f := range r.File {
		destPath := filepath.Join(absTarget, f.Name)

		// Safety: prevent path traversal
		if !strings.HasPrefix(filepath.Clean(destPath)+string(os.PathSeparator), filepath.Clean(absTarget)+string(os.PathSeparator)) &&
			filepath.Clean(destPath) != filepath.Clean(absTarget) {
			return fmt.Errorf("archive entry escapes target directory: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(destPath, 0o755)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			return err
		}

		outFile, err := os.Create(destPath)
		if err != nil {
			rc.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
