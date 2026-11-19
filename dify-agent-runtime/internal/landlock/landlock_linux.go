//go:build linux

package landlock

import (
	"os"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
	ll "github.com/landlock-lsm/go-landlock/landlock/syscall"
)

// getABIVersion is a seam so tests can force the kernel's reported Landlock ABI.
var getABIVersion = ll.LandlockGetABIVersion

// Restrict applies Landlock filesystem restrictions for the current process.
// V2 is preferred; on kernels reporting exactly ABI v1 (Linux 5.13–5.18) it
// falls back to a V1 ruleset. V1 cannot grant REFER, so the kernel denies all
// cross-directory rename/link (EXDEV), including within Home/Cwd. Keep this
// strict: go-landlock v0.9.0 BestEffort downgrades WithRefer rules to v0 (no
// isolation) on ABI < 2, and V1.RestrictPaths rejects WithRefer with EINVAL.
// ABI 0 or a detection error still takes the V2 path, which fails closed with
// the existing "missing kernel Landlock support" error before script exec.
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
