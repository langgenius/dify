//go:build linux

package landlock

import (
	"os"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
)

// Restrict applies Landlock V2 filesystem restrictions for the current process.
// Keep this strict: go-landlock v0.9.0 BestEffort downgrades WithRefer rules to
// v0 (no isolation) on ABI < 2. A V1 fallback would still break cross-directory
// rename/link. Return setup errors so the runner fails closed before script exec.
func Restrict(cfg *Config) error {
	rules := buildRules(cfg)

	if err := golandlock.V2.RestrictPaths(rules...); err != nil {
		return err
	}
	return nil
}

func buildRules(cfg *Config) []golandlock.Rule {
	// Collect RO paths that exist on this system.
	roPaths := filterExisting(cfg.ROPaths)
	if cfg.JobDir != "" {
		roPaths = append(roPaths, cfg.JobDir)
	}

	// Keep primary paths unfiltered so invalid Home/Cwd fail closed. Only these
	// per-job trees receive REFER for cross-directory rename/link operations.
	rwDirs := []string{cfg.Home}
	if cfg.Cwd != "" && cfg.Cwd != cfg.Home {
		rwDirs = append(rwDirs, cfg.Cwd)
	}
	extraRWDirs := filterExisting(cfg.RWPaths)

	// Device files with RW access.
	rwDevFiles := filterExisting(cfg.RWDevPaths)

	rules := []golandlock.Rule{
		golandlock.RWDirs(rwDirs...).WithRefer(),
	}
	if len(extraRWDirs) > 0 {
		// Shared writable paths must not gain REFER, including across the
		// boundary with Home/Cwd, so keep them in a separate rule.
		rules = append(rules, golandlock.RWDirs(extraRWDirs...))
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
