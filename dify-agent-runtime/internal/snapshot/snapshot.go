// Package snapshot implements single-pass streaming save/restore of the
// runtime's Home directory as tar+zstd archives.
//
// SIZE CONTRACT: this package imposes NO size limits. Consumers own size
// policy and must bound the streams they read or send in their own logic —
// count bytes while reading a save stream and abort at their cap; bound what
// they send to restore. In Dify EE the sandbox-gateway enforces this.
package snapshot

import (
	"path/filepath"
	"slices"
)

// WorkspaceDir is the top-level Home entry that is never part of a Home
// Snapshot. SaveHome always skips it, whatever the caller passes as excludes.
const WorkspaceDir = "workspace"

// excluded reports whether rel is left out of the archive. Only top-level
// entries are eligible: WorkspaceDir unconditionally, then the configured set.
func excluded(rel string, excludes []string) bool {
	if filepath.Dir(rel) != "." {
		return false
	}
	if rel == WorkspaceDir {
		return true
	}
	return slices.Contains(excludes, rel)
}
