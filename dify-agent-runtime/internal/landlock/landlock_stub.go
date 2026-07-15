//go:build !linux

package landlock

import "errors"

// ErrNotSupported is returned when the kernel does not support Landlock.
var ErrNotSupported = errors.New("landlock: not supported by kernel")

// Restrict is a no-op on non-Linux platforms; always returns ErrNotSupported.
func Restrict(cfg *Config) error {
	return ErrNotSupported
}

// Verify is a no-op on non-Linux platforms.
func Verify(home string) error {
	return nil
}
