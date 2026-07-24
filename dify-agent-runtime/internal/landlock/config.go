package landlock

import (
	"os"
	"strings"

	"github.com/langgenius/dify/dify-agent-runtime/internal/envvar"
)

// Config holds the path lists for Landlock filesystem restrictions.
type Config struct {
	Home       string   // Agent's home directory (always RW).
	Cwd        string   // Working directory (always RW, may differ from Home).
	JobDir     string   // Job script directory (RO, auto-set by runner).
	RWPaths    []string // Additional read-write directories.
	ROPaths    []string // Read-only + execute directories.
	RWDevPaths []string // Device files with read-write access.
}

var (
	// DefaultRWPaths are directories granted read-write access besides HOME.
	// Agent-specific paths (e.g. drive base) are added dynamically by the runner.
	DefaultRWPaths = []string{}

	// DefaultROPaths are directories granted read-only + execute access.
	DefaultROPaths = []string{
		"/usr",
		"/bin",
		"/sbin",
		"/lib",
		"/lib64",
		"/etc",
		"/proc",
		"/opt/dify-agent-tools",
		"/opt/homebrew",
		"/snap",
	}

	// DefaultRWDevPaths are device files granted read-write access.
	DefaultRWDevPaths = []string{
		"/dev/null",
		"/dev/zero",
		"/dev/urandom",
		"/dev/random",
		"/dev/tty",
	}
)

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig(home, cwd, jobDir string) *Config {
	return &Config{
		Home:       home,
		Cwd:        cwd,
		JobDir:     jobDir,
		RWPaths:    DefaultRWPaths,
		ROPaths:    DefaultROPaths,
		RWDevPaths: DefaultRWDevPaths,
	}
}

// ConfigFromEnv returns a Config populated from environment variables,
// falling back to defaults for any unset variable.
//
// If a variable is set (even to empty string), its value replaces the default.
// Set to empty to grant no additional paths beyond $HOME.
func ConfigFromEnv(home, cwd, jobDir string) *Config {
	cfg := DefaultConfig(home, cwd, jobDir)

	if v, ok := os.LookupEnv(envvar.EnvRWPaths); ok {
		cfg.RWPaths = splitPaths(v)
	}
	if v, ok := os.LookupEnv(envvar.EnvROPaths); ok {
		cfg.ROPaths = splitPaths(v)
	}
	if v, ok := os.LookupEnv(envvar.EnvRWDevPaths); ok {
		cfg.RWDevPaths = splitPaths(v)
	}

	return cfg
}

func splitPaths(s string) []string {
	var paths []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			paths = append(paths, p)
		}
	}
	return paths
}
