package snapshot

import (
	"path"
	"slices"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/snapshot/gitignore"
)

const (
	WorkspaceDir   = "workspace"
	RuntimeDataDir = ".local"
)

// defaultExcludes are the top-level Home entries no Home Snapshot ever
// carries, whatever the caller asks for.
var defaultExcludes = []string{WorkspaceDir, RuntimeDataDir}

// Excluder decides which Home entries stay out of an archive.
//
// Two layers: the runtime's own top-level defaults, and the caller's
// gitignore-syntax patterns, which may match at any depth.
type Excluder struct {
	matcher gitignore.Matcher
}

// NewExcluder compiles caller patterns.
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

func (e *Excluder) Excluded(rel string, isDir bool) bool {
	if isDefaultExcluded(rel) {
		return true
	}
	return e.matcher.Match(strings.Split(rel, "/"), isDir)
}

func isDefaultExcluded(rel string) bool {
	return path.Dir(rel) == "." && slices.Contains(defaultExcludes, rel)
}
