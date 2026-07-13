package agentcli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const defaultConfigBase = ".dify_conf"

// RunConfigManifest executes the `config manifest` command.
func RunConfigManifest(env *Environment) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	body, err := client.GetConfigManifest(context.Background())
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigSkillsPull executes the `config skills pull` command.
func RunConfigSkillsPull(env *Environment, names []string, localDir string, jsonOutput bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	ctx := context.Background()

	// Get manifest to find available skills if no names specified
	if len(names) == 0 {
		body, err := client.GetConfigManifest(ctx)
		if err != nil {
			return err
		}
		var manifest struct {
			Skills struct {
				Items []struct {
					Name string `json:"name"`
				} `json:"items"`
			} `json:"skills"`
		}
		if err := json.Unmarshal(body, &manifest); err != nil {
			return fmt.Errorf("parse manifest: %w", err)
		}
		for _, item := range manifest.Skills.Items {
			names = append(names, item.Name)
		}
	}

	targetDir := localDir
	if targetDir == "" {
		targetDir = filepath.Join(defaultConfigBase, "skills")
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create target directory: %w", err)
	}

	type pullItem struct {
		Name          string `json:"name"`
		ArchivePath   string `json:"archive_path"`
		DirectoryPath string `json:"directory_path"`
		SkillMD       string `json:"skill_md"`
	}
	var items []pullItem

	for _, name := range names {
		archiveBytes, err := client.PullConfigSkill(ctx, name)
		if err != nil {
			return err
		}

		archivePath := filepath.Join(targetDir, name+".zip")
		skillDir := filepath.Join(targetDir, name)
		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			return fmt.Errorf("create skill directory: %w", err)
		}
		if err := os.WriteFile(archivePath, archiveBytes, 0o644); err != nil {
			return fmt.Errorf("write archive: %w", err)
		}

		// Extract archive
		if err := extractZipArchive(archivePath, skillDir); err != nil {
			return fmt.Errorf("extract skill archive: %w", err)
		}

		skillMDPath := filepath.Join(skillDir, "SKILL.md")
		skillMD := ""
		if data, err := os.ReadFile(skillMDPath); err == nil {
			skillMD = string(data)
		}

		items = append(items, pullItem{
			Name:          name,
			ArchivePath:   archivePath,
			DirectoryPath: skillDir,
			SkillMD:       skillMD,
		})
	}

	if jsonOutput {
		out, _ := json.Marshal(map[string]any{"items": items})
		fmt.Println(string(out))
		return nil
	}

	for i, item := range items {
		if i > 0 {
			fmt.Println()
		}
		fmt.Println(item.DirectoryPath)
		fmt.Print(item.SkillMD)
	}
	return nil
}

// RunConfigFilesPull executes the `config files pull` command.
func RunConfigFilesPull(env *Environment, names []string, localDir string, jsonOutput bool) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	ctx := context.Background()

	if len(names) == 0 {
		body, err := client.GetConfigManifest(ctx)
		if err != nil {
			return err
		}
		var manifest struct {
			Files struct {
				Items []struct {
					Name string `json:"name"`
				} `json:"items"`
			} `json:"files"`
		}
		if err := json.Unmarshal(body, &manifest); err != nil {
			return fmt.Errorf("parse manifest: %w", err)
		}
		for _, item := range manifest.Files.Items {
			names = append(names, item.Name)
		}
	}

	targetDir := localDir
	if targetDir == "" {
		targetDir = filepath.Join(defaultConfigBase, "files")
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return fmt.Errorf("create target directory: %w", err)
	}

	type fileItem struct {
		Name string `json:"name"`
		Path string `json:"path"`
	}
	var items []fileItem

	for _, name := range names {
		payload, err := client.PullConfigFile(ctx, name)
		if err != nil {
			return err
		}

		targetPath := filepath.Join(targetDir, name)
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return fmt.Errorf("create parent directory: %w", err)
		}
		if err := os.WriteFile(targetPath, payload, 0o644); err != nil {
			return fmt.Errorf("write file: %w", err)
		}
		items = append(items, fileItem{Name: name, Path: targetPath})
	}

	if jsonOutput {
		out, _ := json.Marshal(map[string]any{"items": items})
		fmt.Println(string(out))
		return nil
	}

	for _, item := range items {
		fmt.Println(item.Path)
	}
	return nil
}

// RunConfigSkillsPush executes the `config skills push` command.
func RunConfigSkillsPush(env *Environment, paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("at least one skill directory is required")
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	type skillPushItem struct {
		Name    string        `json:"name"`
		FileRef *DriveFileRef `json:"file_ref"`
	}
	var skills []skillPushItem

	for _, path := range paths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("resolve path: %w", err)
		}
		info, err := os.Stat(absPath)
		if err != nil || !info.IsDir() {
			return fmt.Errorf("config skill path must be a directory: %s", absPath)
		}
		skillMDPath := filepath.Join(absPath, "SKILL.md")
		if _, err := os.Stat(skillMDPath); os.IsNotExist(err) {
			return fmt.Errorf("config skill directory must contain SKILL.md: %s", absPath)
		}

		// Build archive and upload
		archivePath, err := buildSkillArchive(absPath)
		if err != nil {
			return err
		}
		defer os.Remove(archivePath)

		name := filepath.Base(absPath)
		commitItem, err := uploadAndPrepareCommitItem(client, archivePath, name)
		if err != nil {
			return err
		}

		skills = append(skills, skillPushItem{
			Name:    name,
			FileRef: &DriveFileRef{Kind: commitItem.FileRef.Kind, ID: commitItem.FileRef.ID},
		})
	}

	payload := map[string]any{
		"skills": skills,
		"files":  []any{},
	}

	body, err := client.PushConfig(context.Background(), payload)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigFilesPush executes the `config files push` command.
func RunConfigFilesPush(env *Environment, paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("at least one file path is required")
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	type filePushItem struct {
		Name    string        `json:"name"`
		FileRef *DriveFileRef `json:"file_ref"`
	}
	var files []filePushItem

	for _, path := range paths {
		absPath, err := filepath.Abs(path)
		if err != nil {
			return fmt.Errorf("resolve path: %w", err)
		}
		info, err := os.Stat(absPath)
		if err != nil || info.IsDir() {
			return fmt.Errorf("config file path must be a regular file: %s", absPath)
		}

		name := filepath.Base(absPath)
		commitItem, err := uploadAndPrepareCommitItem(client, absPath, name)
		if err != nil {
			return err
		}

		files = append(files, filePushItem{
			Name:    name,
			FileRef: &DriveFileRef{Kind: commitItem.FileRef.Kind, ID: commitItem.FileRef.ID},
		})
	}

	payload := map[string]any{
		"files":  files,
		"skills": []any{},
	}

	body, err := client.PushConfig(context.Background(), payload)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigSkillsDelete executes the `config skills delete` command.
func RunConfigSkillsDelete(env *Environment, names []string) error {
	if len(names) == 0 {
		return fmt.Errorf("at least one skill name is required")
	}

	type skillDeleteItem struct {
		Name    string `json:"name"`
		FileRef *any   `json:"file_ref"`
	}
	var skills []skillDeleteItem
	for _, name := range names {
		skills = append(skills, skillDeleteItem{Name: name, FileRef: nil})
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	payload := map[string]any{
		"skills": skills,
		"files":  []any{},
	}

	body, err := client.PushConfig(context.Background(), payload)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigFilesDelete executes the `config files delete` command.
func RunConfigFilesDelete(env *Environment, names []string) error {
	if len(names) == 0 {
		return fmt.Errorf("at least one file name is required")
	}

	type fileDeleteItem struct {
		Name    string `json:"name"`
		FileRef *any   `json:"file_ref"`
	}
	var files []fileDeleteItem
	for _, name := range names {
		files = append(files, fileDeleteItem{Name: name, FileRef: nil})
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	payload := map[string]any{
		"files":  files,
		"skills": []any{},
	}

	body, err := client.PushConfig(context.Background(), payload)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigEnvPush executes the `config env push` command.
func RunConfigEnvPush(env *Environment, localPath string) error {
	var envText string
	if localPath == "-" {
		data, err := os.ReadFile("/dev/stdin")
		if err != nil {
			return fmt.Errorf("read stdin: %w", err)
		}
		envText = string(data)
	} else {
		absPath, err := filepath.Abs(localPath)
		if err != nil {
			return fmt.Errorf("resolve path: %w", err)
		}
		data, err := os.ReadFile(absPath)
		if err != nil {
			return fmt.Errorf("read file: %w", err)
		}
		envText = string(data)
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	body, err := client.PatchConfigEnv(context.Background(), envText)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// RunConfigNotePull executes the `config note pull` command.
func RunConfigNotePull(env *Environment, localPath string) error {
	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	body, err := client.GetConfigManifest(context.Background())
	if err != nil {
		return err
	}

	var manifest struct {
		Note string `json:"note"`
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		return fmt.Errorf("parse manifest: %w", err)
	}

	targetPath := localPath
	if targetPath == "" {
		targetPath = filepath.Join(defaultConfigBase, "note.md")
	}
	absPath, err := filepath.Abs(targetPath)
	if err != nil {
		return fmt.Errorf("resolve path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}
	if err := os.WriteFile(absPath, []byte(manifest.Note), 0o644); err != nil {
		return fmt.Errorf("write note: %w", err)
	}
	fmt.Println(absPath)
	return nil
}

// RunConfigNotePush executes the `config note push` command.
func RunConfigNotePush(env *Environment, localPath string) error {
	var note string
	if localPath == "-" {
		data, err := os.ReadFile("/dev/stdin")
		if err != nil {
			return fmt.Errorf("read stdin: %w", err)
		}
		note = string(data)
	} else {
		targetPath := localPath
		if targetPath == "" {
			targetPath = filepath.Join(defaultConfigBase, "note.md")
		}
		absPath, err := filepath.Abs(targetPath)
		if err != nil {
			return fmt.Errorf("resolve path: %w", err)
		}
		data, err := os.ReadFile(absPath)
		if err != nil {
			return fmt.Errorf("read file: %w", err)
		}
		note = string(data)
	}

	client, err := NewStubClient(env)
	if err != nil {
		return err
	}
	defer client.Close()

	body, err := client.PutConfigNote(context.Background(), note)
	if err != nil {
		return err
	}
	fmt.Println(string(body))
	return nil
}

// extractZipArchive extracts a zip file into targetDir.
func extractZipArchive(archivePath string, targetDir string) error {
	return extractZip(archivePath, targetDir)
}
