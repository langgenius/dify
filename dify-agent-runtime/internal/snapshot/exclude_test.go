package snapshot

import "testing"

// Caller patterns are gitignore syntax and reach any depth, which plain
// top-level name matching could not express.
func TestExcluderCallerPatterns(t *testing.T) {
	for name, tc := range map[string]struct {
		patterns []string
		rel      string
		isDir    bool
		want     bool
	}{
		"exact top-level name":       {[]string{".cache"}, ".cache", true, true},
		"bare name at depth":         {[]string{"node_modules"}, "src/app/node_modules", true, true},
		"bare name matches file":     {[]string{"tags"}, "src/tags", false, true},
		"anchored hits root only":    {[]string{"/build"}, "build", true, true},
		"anchored misses depth":      {[]string{"/build"}, "src/build", true, false},
		"suffix glob":                {[]string{"*.log"}, "var/app.log", false, true},
		"suffix glob non-match":      {[]string{"*.log"}, "var/app.txt", false, false},
		"doublestar spans segments":  {[]string{".cache/**"}, ".cache/a/b/c.bin", false, true},
		"doublestar mid-pattern":     {[]string{"src/**/dist"}, "src/a/b/dist", true, true},
		"dir-only skips file":        {[]string{"target/"}, "target", false, false},
		"dir-only matches dir":       {[]string{"target/"}, "target", true, true},
		"question mark":              {[]string{"tmp?"}, "tmp1", false, true},
		"unmatched pattern is inert": {[]string{"nothing-here"}, "bin/tool.sh", false, false},
		"no patterns":                {nil, "bin/tool.sh", false, false},
	} {
		t.Run(name, func(t *testing.T) {
			got := NewExcluder(tc.patterns).Excluded(tc.rel, tc.isDir)
			if got != tc.want {
				t.Errorf("Excluded(%q, isDir=%v) with %v = %v, want %v",
					tc.rel, tc.isDir, tc.patterns, got, tc.want)
			}
		})
	}
}

// Within the caller's own list, a later "!" pattern re-includes what an
// earlier one excluded — standard last-match-wins.
func TestExcluderCallerNegationWins(t *testing.T) {
	e := NewExcluder([]string{".cache/**", "!.cache/keep-me"})
	if !e.Excluded(".cache/junk", false) {
		t.Error(".cache/junk should be excluded by .cache/**")
	}
	if e.Excluded(".cache/keep-me", false) {
		t.Error(".cache/keep-me should be re-included by the later ! pattern")
	}
}

// The two layers are ordered: defaults are decided before caller patterns are
// consulted, so no caller pattern can subtract from them.
func TestExcluderDefaultsBeatCallerPatterns(t *testing.T) {
	for _, pattern := range []string{
		"!" + RuntimeStateDir,
		"!/" + RuntimeStateDir,
		"!" + RuntimeStateDir + "/**",
		"!**",
	} {
		t.Run(pattern, func(t *testing.T) {
			e := NewExcluder([]string{pattern})
			for _, dir := range defaultExcludes {
				if !e.Excluded(dir, true) {
					t.Errorf("%q pulled %s back in", pattern, dir)
				}
			}
		})
	}
}

// Blank entries are dropped rather than compiled into a pattern that would
// match everything or nothing surprisingly.
func TestExcluderIgnoresBlankPatterns(t *testing.T) {
	e := NewExcluder([]string{"", "   ", "\t"})
	if e.Excluded("bin/tool.sh", false) {
		t.Error("blank patterns must not exclude anything")
	}
}
