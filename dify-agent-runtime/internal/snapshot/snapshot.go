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

// WorkspaceDir is the Workspace root, which a Home Snapshot deliberately
// leaves behind.
const WorkspaceDir = "workspace"

// RuntimeDataDir is the XDG data root, holding the server's own job records
// and SQLite database. Restoring it would overwrite the state of the live
// server serving the restore.
const RuntimeDataDir = ".local"

// defaultExcludes are the top-level Home entries no Home Snapshot ever
// carries. Caller-supplied excludes add to this set; they cannot subtract
// from it.
var defaultExcludes = []string{WorkspaceDir, RuntimeDataDir}

// excluded reports whether rel is left out of the archive. Only top-level
// entries are eligible: defaultExcludes unconditionally, then the configured
// set.
func excluded(rel string, excludes []string) bool {
	if filepath.Dir(rel) != "." {
		return false
	}
	return slices.Contains(defaultExcludes, rel) || slices.Contains(excludes, rel)
}
