// Package snapshot implements single-pass streaming save/restore of the
// runtime's Home directory as tar+zstd archives.
//
// SIZE CONTRACT: this package imposes NO size limits. Consumers own size
// policy and must bound the streams they read or send in their own logic —
// count bytes while reading a save stream and abort at their cap; bound what
// they send to restore. In Dify EE the sandbox-gateway enforces this.
package snapshot

import (
	"path"
	"slices"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/snapshot/gitignore"
)

// WorkspaceDir is the Workspace root, which a Home Snapshot deliberately
// leaves behind.
const WorkspaceDir = "workspace"

// RuntimeDataDir is the XDG data root, holding the server's own job records
// and SQLite database. Restoring it would overwrite the state of the live
// server serving the restore.
const RuntimeDataDir = ".local"

// defaultExcludes are the top-level Home entries no Home Snapshot ever
// carries, whatever the caller asks for.
var defaultExcludes = []string{WorkspaceDir, RuntimeDataDir}

// Excluder decides which Home entries stay out of an archive.
//
// Two layers: the runtime's own top-level defaults, and the caller's
// gitignore-syntax patterns, which may match at any depth.
//
// A caller can never negotiate a default away, and not merely because the
// defaults are checked first — the defaults are deliberately kept out of the
// matcher. A matcher answers "excluded?" with a bool, so a "!" pattern can
// only cancel another caller pattern; it has no way to force an inclusion
// back past a decision the matcher was never consulted about. Compiling the
// defaults in as ordinary patterns would break exactly this.
type Excluder struct {
	matcher gitignore.Matcher
}

// NewExcluder compiles caller patterns. Each is gitignore syntax: "*" and "?"
// within a path segment, "**" across segments, a leading "/" to anchor at the
// Home root, a trailing "/" to match directories only, and a leading "!" to
// re-include something an earlier pattern excluded. Later patterns win over
// earlier ones. Patterns that match nothing are simply inert.
func NewExcluder(patterns []string) *Excluder {
	compiled := make([]gitignore.Pattern, 0, len(patterns))
	for _, p := range patterns {
		if strings.TrimSpace(p) == "" {
			continue
		}
		compiled = append(compiled, gitignore.ParsePattern(p, nil))
	}
	return &Excluder{matcher: gitignore.NewMatcher(compiled)}
}

// Excluded reports whether rel — a slash-separated path relative to Home — is
// left out of the archive.
func (e *Excluder) Excluded(rel string, isDir bool) bool {
	if isDefaultExcluded(rel) {
		return true
	}
	return e.matcher.Match(strings.Split(rel, "/"), isDir)
}

// isDefaultExcluded matches the runtime's own defaults, which are top-level
// entries only: a nested "bin/workspace" is ordinary Home content.
func isDefaultExcluded(rel string) bool {
	return path.Dir(rel) == "." && slices.Contains(defaultExcludes, rel)
}
