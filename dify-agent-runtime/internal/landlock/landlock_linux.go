//go:build linux

package landlock

import (
	"errors"
	"fmt"
	"os"
	"syscall"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
)

// ErrNotSupported is returned when the kernel does not support Landlock.
var ErrNotSupported = errors.New("landlock: not supported by kernel")

// Restrict applies Landlock filesystem restrictions for the current process.
//
// It first tries strict enforcement.  If the kernel lacks Landlock support,
// it falls back to BestEffort (which may silently degrade) and returns
// ErrNotSupported so callers can log a warning.
func Restrict(cfg *Config) error {
	rules := buildRules(cfg)

	if err := golandlock.V5.RestrictPaths(rules...); err != nil {
		if !isNotSupported(err) {
			return fmt.Errorf("landlock: restrict paths: %w", err)
		}
		if err2 := golandlock.V5.BestEffort().RestrictPaths(rules...); err2 != nil {
			return fmt.Errorf("landlock: best-effort restrict paths: %w", err2)
		}
		return ErrNotSupported
	}
	return nil
}

func buildRules(cfg *Config) []golandlock.Rule {
	// Collect RO paths that exist on this system.
	roPaths := filterExisting(cfg.ROPaths)
	if cfg.JobDir != "" {
		roPaths = append(roPaths, cfg.JobDir)
	}

	// RW dirs: always include HOME and Cwd, plus configured extra paths.
	rwDirs := []string{cfg.Home}
	if cfg.Cwd != "" && cfg.Cwd != cfg.Home {
		rwDirs = append(rwDirs, cfg.Cwd)
	}
	rwDirs = append(rwDirs, filterExisting(cfg.RWPaths)...)

	// Device files with RW access.
	rwDevFiles := filterExisting(cfg.RWDevPaths)

	rules := []golandlock.Rule{
		golandlock.RWDirs(rwDirs...),
	}
	if len(roPaths) > 0 {
		rules = append(rules, golandlock.RODirs(roPaths...))
	}
	if len(rwDevFiles) > 0 {
		rules = append(rules, golandlock.RWFiles(rwDevFiles...))
	}
	return rules
}

// isNotSupported reports whether err indicates the kernel does not support
// Landlock (ENOSYS = syscall absent, EOPNOTSUPP = feature disabled).
func isNotSupported(err error) bool {
	return errors.Is(err, syscall.ENOSYS) || errors.Is(err, syscall.EOPNOTSUPP)
}

func filterExisting(paths []string) []string {
	var out []string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}
