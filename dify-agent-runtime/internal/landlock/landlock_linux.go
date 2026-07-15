//go:build linux

package landlock

import (
	"errors"
	"fmt"
	"os"

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
		if err2 := golandlock.V5.BestEffort().RestrictPaths(rules...); err2 != nil {
			return fmt.Errorf("landlock: restrict paths: %w", err2)
		}
		return ErrNotSupported
	}
	return nil
}

// Verify checks whether Landlock is actually enforced by attempting to
// read a probe path that should be denied.  Returns nil if the access is
// correctly denied, or an error describing the problem.
func Verify(home string) error {
	probes := []string{"/root", "/var/log"}
	for _, p := range probes {
		if p == home {
			continue
		}
		if _, err := os.Stat(p); err != nil {
			continue
		}
		f, err := os.Open(p)
		if err != nil {
			return nil
		}
		f.Close()
		return fmt.Errorf("landlock: verification failed: %s is accessible (should be denied)", p)
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

func filterExisting(paths []string) []string {
	var out []string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}
