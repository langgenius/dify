package agentcli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// DriveItem represents one item in a drive manifest.
type DriveItem struct {
	Key         string  `json:"key"`
	Size        *int64  `json:"size,omitempty"`
	MimeType    string  `json:"mime_type,omitempty"`
	Hash        string  `json:"hash,omitempty"`
	DownloadURL *string `json:"download_url,omitempty"`
}

// DriveManifestResponse is the drive manifest from the Agent Stub.
type DriveManifestResponse struct {
	Items []DriveItem `json:"items"`
}

// DrivePullResultItem represents one pulled drive file.
type DrivePullResultItem struct {
	Key       string `json:"key"`
	LocalPath string `json:"local_path"`
}

// DrivePullResult is the JSON output for `dify-agent drive pull --json`.
type DrivePullResult struct {
	Items []DrivePullResultItem `json:"items"`
}

// DriveCommitItem represents one file to commit into the drive.
type DriveCommitItem struct {
	Key     string       `json:"key"`
	FileRef DriveFileRef `json:"file_ref"`
}

// DriveFileRef is the reference to an uploaded file.
type DriveFileRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// DriveCommitResponse is the response from a drive commit.
type DriveCommitResponse struct {
	Items []DriveItem `json:"items"`
}

// RunDriveList executes the `drive list` command.
func RunDriveList(env *Environment, pathPrefix string, jsonOutput bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	manifest, err := client.GetDriveManifest(context.Background(), pathPrefix, false)
	if err != nil {
		return err
	}

	if jsonOutput {
		out, _ := json.Marshal(manifest)
		fmt.Println(string(out))
		return nil
	}

	for _, item := range manifest.Items {
		size := "-"
		if item.Size != nil {
			size = fmt.Sprintf("%d", *item.Size)
		}
		mimeType := item.MimeType
		if mimeType == "" {
			mimeType = "-"
		}
		hash := item.Hash
		if hash == "" {
			hash = "-"
		}
		fmt.Printf("%s\t%s\t%s\t%s\n", size, mimeType, hash, item.Key)
	}
	return nil
}

// RunDrivePull executes the `drive pull` command.
func RunDrivePull(env *Environment, targets []string, localBase string, jsonOutput bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	if localBase == "" {
		localBase = ReadDriveBase()
	}
	resolvedBase, err := filepath.Abs(localBase)
	if err != nil {
		return fmt.Errorf("resolve drive base: %w", err)
	}

	if len(targets) == 0 {
		targets = []string{""}
	}

	ctx := context.Background()
	resultItems := []DrivePullResultItem{}

	for _, target := range targets {
		manifest, err := client.GetDriveManifest(ctx, target, true)
		if err != nil {
			return err
		}

		if len(manifest.Items) == 0 {
			continue
		}

		localPath := resolveDriveDestination(resolvedBase, target)
		resultItems = append(resultItems, DrivePullResultItem{Key: target, LocalPath: localPath})

		for _, item := range manifest.Items {
			if item.DownloadURL == nil || *item.DownloadURL == "" {
				return fmt.Errorf("drive manifest item is missing download_url: %s", item.Key)
			}

			destPath := resolveDriveDestination(resolvedBase, item.Key)
			destDir := filepath.Dir(destPath)
			if err := os.MkdirAll(destDir, 0o755); err != nil {
				return fmt.Errorf("create directory: %w", err)
			}

			data, err := client.DownloadFromURL(*item.DownloadURL)
			if err != nil {
				return fmt.Errorf("download %s: %w", item.Key, err)
			}

			if err := os.WriteFile(destPath, data, 0o644); err != nil {
				return fmt.Errorf("write %s: %w", destPath, err)
			}
		}
	}

	if jsonOutput {
		out, _ := json.Marshal(DrivePullResult{Items: resultItems})
		fmt.Println(string(out))
		return nil
	}

	for _, item := range resultItems {
		fmt.Println(item.LocalPath)
	}
	return nil
}

// RunDrivePush executes the `drive push` command.
func RunDrivePush(env *Environment, localPath string, drivePath string, kind string) error {
	absPath, err := filepath.Abs(localPath)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return fmt.Errorf("local path not found: %s", absPath)
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()

	if info.IsDir() {
		if kind == "" {
			return fmt.Errorf("directory drive push requires --kind skill or --kind dir")
		}
		if kind == "file" {
			return fmt.Errorf("--kind file requires a file")
		}
		if kind == "dir" {
			return pushDirectory(client, absPath, drivePath)
		}
		return pushSkillDirectory(client, absPath, drivePath)
	}

	// Single file push
	if kind == "skill" {
		return fmt.Errorf("--kind skill requires a directory containing SKILL.md")
	}
	if kind == "dir" {
		return fmt.Errorf("--kind dir requires a directory")
	}

	commitItem, err := uploadAndPrepareCommitItem(client, absPath, drivePath)
	if err != nil {
		return err
	}

	return commitDriveItems(client, []DriveCommitItem{*commitItem})
}

func pushDirectory(client StubClient, dirPath string, drivePath string) error {
	var items []DriveCommitItem

	err := filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if shouldSkipDir(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("drive push does not support symlinked files: %s", path)
		}

		relPath, _ := filepath.Rel(dirPath, path)
		driveKey := joinDriveKey(drivePath, filepath.ToSlash(relPath))
		commitItem, err := uploadAndPrepareCommitItem(client, path, driveKey)
		if err != nil {
			return err
		}
		items = append(items, *commitItem)
		return nil
	})
	if err != nil {
		return err
	}

	if len(items) == 0 {
		return fmt.Errorf("directory has no regular files: %s", dirPath)
	}

	return commitDriveItems(client, items)
}

func pushSkillDirectory(client StubClient, dirPath string, drivePath string) error {
	skillMDPath := filepath.Join(dirPath, "SKILL.md")
	if _, err := os.Stat(skillMDPath); os.IsNotExist(err) {
		return fmt.Errorf("--kind skill requires a directory containing SKILL.md")
	}

	// Upload SKILL.md
	skillMDItem, err := uploadAndPrepareCommitItem(client, skillMDPath, joinDriveKey(drivePath, "SKILL.md"))
	if err != nil {
		return err
	}

	// Build and upload archive
	archivePath, err := buildSkillArchive(dirPath)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(archivePath) }()

	archiveItem, err := uploadAndPrepareCommitItem(client, archivePath, joinDriveKey(drivePath, ".DIFY-SKILL-FULL.zip"))
	if err != nil {
		return err
	}

	return commitDriveItems(client, []DriveCommitItem{*skillMDItem, *archiveItem})
}

func uploadAndPrepareCommitItem(client StubClient, filePath string, driveKey string) (*DriveCommitItem, error) {
	filename := filepath.Base(filePath)
	mimetype := guessMIMEType(filename)
	ctx := context.Background()

	// Request upload URL
	uploadURL, err := client.CreateFileUploadURL(ctx, filename, mimetype)
	if err != nil {
		return nil, err
	}

	// Upload
	uploadBody, err := client.UploadFileToURL(uploadURL, filePath, filename, mimetype)
	if err != nil {
		return nil, err
	}

	var uploadResult map[string]any
	if err := json.Unmarshal(uploadBody, &uploadResult); err != nil {
		return nil, fmt.Errorf("parse upload result: %w", err)
	}

	toolFileID, _ := uploadResult["id"].(string)
	if toolFileID == "" {
		return nil, fmt.Errorf("upload response is missing id")
	}

	return &DriveCommitItem{
		Key:     driveKey,
		FileRef: DriveFileRef{Kind: "tool_file", ID: toolFileID},
	}, nil
}

func commitDriveItems(client StubClient, items []DriveCommitItem) error {
	body, err := client.CommitDrive(context.Background(), items)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

func resolveDriveDestination(basePath string, key string) string {
	if key == "" {
		return basePath
	}
	return filepath.Join(basePath, filepath.FromSlash(key))
}

func joinDriveKey(base string, child string) string {
	stripped := strings.TrimRight(base, "/")
	child = strings.TrimLeft(child, "/")
	if stripped == "" {
		return child
	}
	return stripped + "/" + child
}

func shouldSkipDir(name string) bool {
	skip := map[string]bool{
		".git": true, "__pycache__": true, ".pytest_cache": true,
		".mypy_cache": true, ".ruff_cache": true, ".venv": true, "node_modules": true,
	}
	return skip[name]
}

// buildSkillArchive creates a zip archive of the skill directory.
func buildSkillArchive(dirPath string) (string, error) {
	// Create temp file for archive
	tmpFile, err := os.CreateTemp("", "skill-archive-*.zip")
	if err != nil {
		return "", fmt.Errorf("create temp archive: %w", err)
	}
	archivePath := tmpFile.Name()
	_ = tmpFile.Close()

	if err := createZipArchive(archivePath, dirPath); err != nil {
		_ = os.Remove(archivePath)
		return "", err
	}
	return archivePath, nil
}
