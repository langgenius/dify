//go:build linux

package landlock

import (
	"os"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
	ll "github.com/landlock-lsm/go-landlock/landlock/syscall"
)

// Overridden in tests.
var getABIVersion = ll.LandlockGetABIVersion

// Restrict applies Landlock filesystem restrictions for the current process.
// ABI v1 kernels get a V1 ruleset: REFER cannot be granted there, so all
// cross-directory rename/link fail with EXDEV. BestEffort is not an option
// because go-landlock v0.9.0 downgrades WithRefer rules to no isolation.
// Any other setup failure is returned so the runner fails closed.
func Restrict(cfg *Config) error {
	if abi, err := getABIVersion(); err == nil && abi == 1 {
		return golandlock.V1.RestrictPaths(buildRules(cfg, false)...)
	}
	return golandlock.V2.RestrictPaths(buildRules(cfg, true)...)
}

func buildRules(cfg *Config, refer bool) []golandlock.Rule {
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

	homeRule := golandlock.RWDirs(rwDirs...)
	if refer {
		homeRule = homeRule.WithRefer()
	}
	rules := []golandlock.Rule{homeRule}
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
