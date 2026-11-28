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
	"path/filepath"
	"slices"
	"strings"
	"syscall"
)

// RestoreState replaces both writable trees on a fresh sandbox and preserves
// the new runtime's state directories. Callers discard the sandbox on error.
func RestoreState(ctx context.Context, src io.Reader, homeDir, workspaceDir string, runtimeDirs ...string) (RestoreResult, error) {
	homeTree, workspaceTree, err := resolveStateLayout(homeDir, workspaceDir, runtimeDirs)
	if err != nil {
		return RestoreResult{}, err
	}
	home, err := os.OpenRoot(homeTree.dir)
	if err != nil {
		return RestoreResult{}, err
	}
	defer func() { _ = home.Close() }()
	workspace, err := os.OpenRoot(workspaceTree.dir)
	if err != nil {
		return RestoreResult{}, err
	}
	defer func() { _ = workspace.Close() }()

	if err := clearTree(ctx, workspace, ".", workspaceTree.preserved); err != nil {
		return RestoreResult{}, err
	}
	if err := clearTree(ctx, home, ".", homeTree.preserved); err != nil {
		return RestoreResult{}, err
	}
	return restoreArchive(ctx, src, func(name string, kind byte) (*os.Root, string, error) {
		prefix, rel, _ := strings.Cut(name, "/")
		rel, err := cleanEntryName(rel)
		if err != nil {
			return nil, "", err
		}
		if rel == "" {
			rel = "."
		}
		var root *os.Root
		var preserved protectedPaths
		switch prefix {
		case workspacePrefix:
			root, preserved = workspace, workspaceTree.preserved
		case homePrefix:
			root, preserved = home, homeTree.preserved
		default:
			return nil, "", fmt.Errorf("%w: unexpected state entry %q", ErrMalformed, name)
		}
		reserved, ancestor := preserved.match(rel)
		if reserved {
			return nil, "", fmt.Errorf("%w: entry %q targets runtime state", ErrMalformed, name)
		}
		if ancestor && kind != tar.TypeDir {
			return nil, "", fmt.Errorf("%w: runtime state ancestor %q must be a directory", ErrMalformed, name)
		}
		// The writer archives symlinks as leaves. Reject writes and hardlink
		// targets reached through a symlink, which could alias runtime state.
		for component := rel; component != "."; component = path.Dir(component) {
			info, err := root.Lstat(component)
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			if err != nil {
				return nil, "", classifyEntryErr(err)
			}
			if info.Mode()&fs.ModeSymlink != 0 {
				return nil, "", fmt.Errorf("%w: state entry %q traverses symlink %q", ErrMalformed, name, component)
			}
		}
		if ancestor {
			if info, err := root.Lstat(rel); err == nil && info.IsDir() {
				// Keep the destination's permissions on directories the
				// running shellctl needs to reach its live state.
				return root, "", nil
			}
		}
		return root, rel, nil
	})
}

type protectedPaths []string

func (p protectedPaths) match(name string) (reserved, ancestor bool) {
	for _, dir := range p {
		if name == dir || strings.HasPrefix(name, dir+"/") {
			return true, false
		}
		ancestor = ancestor || name == "." || strings.HasPrefix(dir, name+"/")
	}
	return false, ancestor
}

type stateTree struct {
	dir       string
	preserved protectedPaths
}

func (t *stateTree) preserve(root, dir string) error {
	rel, err := filepath.Rel(root, dir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil // The directory is outside this archive root.
	}
	if rel == "." {
		return fmt.Errorf("runtime state directory %q coincides with an archive root", dir)
	}
	rel = filepath.ToSlash(rel)
	if !slices.Contains(t.preserved, rel) {
		t.preserved = append(t.preserved, rel)
	}
	return nil
}

func resolveStateLayout(homeDir, workspaceDir string, runtimeDirs []string) (stateTree, stateTree, error) {
	home, workspace, err := resolveStateDirectories(homeDir, workspaceDir)
	if err != nil {
		return stateTree{}, stateTree{}, err
	}
	homeTree := stateTree{dir: home, preserved: protectedPaths{RuntimeStateDir}}
	workspaceTree := stateTree{dir: workspace}
	for _, dir := range runtimeDirs {
		if dir == "" {
			continue
		}
		absolute, err := filepath.Abs(dir)
		if err != nil {
			return stateTree{}, stateTree{}, err
		}
		resolved, err := filepath.EvalSymlinks(absolute)
		if errors.Is(err, fs.ErrNotExist) {
			resolved = absolute
		} else if err != nil {
			return stateTree{}, stateTree{}, err
		}
		for _, root := range []struct {
			tree *stateTree
			name string
		}{{&homeTree, homeDir}, {&workspaceTree, workspaceDir}} {
			// Protect the resolved directory and validate the configured path
			// where it passes through either writable tree.
			projections := []struct{ base, directory string }{
				{root.tree.dir, resolved}, {root.tree.dir, absolute}, {root.name, absolute},
			}
			for _, projected := range projections {
				if err := root.tree.preserve(projected.base, projected.directory); err != nil {
					return stateTree{}, stateTree{}, err
				}
			}
		}
	}
	return homeTree, workspaceTree, nil
}

func resolveStateDirectories(home, workspace string) (string, string, error) {
	home, err := filepath.EvalSymlinks(home)
	if err != nil {
		return "", "", err
	}
	workspace, err = filepath.EvalSymlinks(workspace)
	if err != nil {
		return "", "", err
	}
	if !filepath.IsAbs(home) || !filepath.IsAbs(workspace) ||
		strings.HasPrefix(home+"/", workspace+"/") ||
		strings.HasPrefix(workspace+"/", home+"/") ||
		home == "/" || workspace == "/" {
		return "", "", fmt.Errorf("home and workspace must be separate absolute directories")
	}
	return home, workspace, nil
}

func clearTree(ctx context.Context, root *os.Root, dir string, preserved protectedPaths) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entries, err := writableDirectoryEntries(root, dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		name := path.Join(dir, entry.Name())
		reserved, ancestor := preserved.match(name)
		if (reserved || ancestor) && !entry.IsDir() {
			return fmt.Errorf("runtime state path %q must be a directory", name)
		}
		if reserved {
			continue
		}
		if entry.IsDir() {
			if err := clearTree(ctx, root, name, preserved); err != nil {
				return err
			}
			if ancestor {
				continue
			}
		}
		if err := root.Remove(name); err != nil {
			return err
		}
	}
	return nil
}

func writableDirectoryEntries(root *os.Root, name string) ([]fs.DirEntry, error) {
	// Fresh claims can contain read-only directories from the image. Change
	// permissions on the opened directory without following a final symlink.
	dir, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_DIRECTORY, 0)
	if err != nil {
		return nil, err
	}
	defer func() { _ = dir.Close() }()
	info, err := dir.Stat()
	if err != nil {
		return nil, err
	}
	if mode := info.Mode().Perm(); mode&0o700 != 0o700 {
		if err := dir.Chmod(mode | 0o700); err != nil {
			return nil, err
		}
	}
	return dir.ReadDir(-1)
}
