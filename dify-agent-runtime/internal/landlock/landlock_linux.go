//go:build linux

package landlock

import (
	"errors"
	"os"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
)

// ErrNotSupported is returned when the kernel does not support Landlock.
var ErrNotSupported = errors.New("landlock: not supported by kernel")

// Restrict applies Landlock V1 filesystem restrictions for the current process.
//
// It uses BestEffort mode so it works on any kernel with Landlock (≥ 5.13).
// If the kernel has no Landlock at all, ErrNotSupported is returned so callers
// can log a warning.
func Restrict(cfg *Config) error {
	rules := buildRules(cfg)

	if err := golandlock.V1.BestEffort().RestrictPaths(rules...); err != nil {
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

func filterExisting(paths []string) []string {
	var out []string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}
