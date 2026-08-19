// Package snapshot implements single-pass streaming save/restore of the
// runtime's Home directory as tar+zstd archives.
//
// SIZE CONTRACT: this package imposes NO size limits. Consumers own size
// policy and must bound the streams they read or send in their own logic —
// count bytes while reading a save stream and abort at their cap; bound what
// they send to restore. In Dify EE the sandbox-gateway enforces this.
package snapshot

import (
	"fmt"
	"strings"
)

// ValidateExcludes rejects exclude entries that are not single path segments.
func ValidateExcludes(excludes []string) error {
	for _, e := range excludes {
		if e == "" || e == "." || e == ".." || strings.ContainsAny(e, `/\`) {
			return fmt.Errorf("invalid home snapshot exclude %q: must be a single path segment", e)
		}
	}
	return nil
}
