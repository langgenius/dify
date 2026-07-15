package landlock

const (
	// EnvEnablePathIsolation controls whether Landlock is applied at all.
	EnvEnablePathIsolation = "ENABLE_PATH_ISOLATION"

	// EnvRWPaths overrides the default RW directories (comma-separated).
	EnvRWPaths = "LANDLOCK_RW_PATHS"

	// EnvROPaths overrides the default RO+exec directories (comma-separated).
	EnvROPaths = "LANDLOCK_RO_PATHS"

	// EnvRWDevPaths overrides the default device files (comma-separated).
	EnvRWDevPaths = "LANDLOCK_RW_DEV_PATHS"
)
