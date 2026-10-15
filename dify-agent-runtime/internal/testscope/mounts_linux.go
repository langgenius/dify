//go:build linux

package testscope

import (
	"errors"
	"fmt"
	"github.com/langgenius/dify/dify-agent-runtime/internal/landlock"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ResolveReference accepts only opaque single-segment references under a
// deployment-owned root. Symlinks are forbidden, including within the root.
func ResolveReference(root, ref string) (string, error) {
	if !safeID.MatchString(ref) {
		return "", errors.New("invalid source reference")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	if canonical != root {
		return "", errors.New("trusted root contains symlink")
	}
	path := filepath.Join(root, ref)
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("source reference is a symlink")
	}
	if !strings.HasPrefix(path, root+string(os.PathSeparator)) {
		return "", errors.New("source reference escaped root")
	}
	return path, nil
}

// WorkerSetupFailure labels trusted setup stages without copying paths, payloads,
// config, or arbitrary error text into the parent readiness diagnostic. Callers
// must use fixed stage identifiers; the original cause remains unwrap-able.
func WorkerSetupFailure(stage string, err error) error {
	if err == nil {
		return nil
	}
	var nested *workerSetupFailure
	if errors.As(err, &nested) {
		stage += "/" + nested.stage
	}
	return &workerSetupFailure{stage: stage, cause: err}
}

type workerSetupFailure struct {
	stage string
	cause error
}

func (e *workerSetupFailure) Error() string {
	var errno unix.Errno
	if errors.As(e.cause, &errno) {
		return fmt.Sprintf("native worker setup %s: errno=%d (%s)", e.stage, errno, errno.Error())
	}
	return "native worker setup " + e.stage + ": operation failed"
}
func (e *workerSetupFailure) Unwrap() error { return e.cause }

// PrepareWorker runs only in a fresh kernel-created user/mount/PID/net namespace.
// The payload root contains image binaries and selected immutable data, never
// supervisor state, credentials, host sockets, or the host /proc.
func PrepareWorker(cfg WorkerConfig) (setupErr error) {
	stage := "bootstrap-policy"
	defer func() { setupErr = WorkerSetupFailure(stage, setupErr) }()
	if err := VerifyBootstrapPolicy(); err != nil {
		return err
	}
	stage = "pid-namespace"
	if os.Getpid() != 1 {
		return errors.New("scope worker must own PID namespace")
	}
	stage = "spec-validation"
	if err := cfg.Spec.Validate(); err != nil {
		return err
	}
	stage = "mount-private"
	if err := unix.Mount("", "/", "", unix.MS_REC|unix.MS_PRIVATE, ""); err != nil {
		return err
	}
	stage = "mount-worker-proc"
	if err := unix.Mount("proc", "/proc", "proc", unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC, ""); err != nil {
		return err
	}
	root := filepath.Join(cfg.Directory, "payload")
	stage = "payload-directory"
	if err := os.Mkdir(root, 0700); err != nil {
		return err
	}
	stage = "mount-payload-tmpfs"
	if err := unix.Mount("tmpfs", root, "tmpfs", unix.MS_NOSUID|unix.MS_NODEV, fmt.Sprintf("size=%d,nr_inodes=65536,mode=0755", cfg.Spec.Limits.DiskBytes)); err != nil {
		return err
	}
	stage = "payload-layout"
	for _, path := range []string{"usr", "bin", "sbin", "lib", "lib64", "etc", "etc/ssl", "dev", "proc", "home/dify", "workspace", "tmp", "inputs", "base", ".job"} {
		if err := os.MkdirAll(filepath.Join(root, path), 0755); err != nil {
			return err
		}
	}
	// Entry labels are fixed identifiers, never source/config-derived paths.
	for _, image := range []struct{ path, label string }{
		{"/usr", "usr"}, {"/bin", "bin"}, {"/sbin", "sbin"},
		{"/lib", "lib"}, {"/lib64", "lib64"}, {"/etc/ssl", "ssl"},
	} {
		stage = "mount-image/" + image.label
		path := image.path
		if _, err := os.Stat(path); os.IsNotExist(err) {
			continue
		}
		if err := readonlyBind(path, filepath.Join(root, path)); err != nil {
			return err
		}
	}
	for _, name := range []string{"null", "zero", "random", "urandom", "tty"} {
		dst := filepath.Join(root, "dev", name)
		stage = "device-placeholder"
		f, err := os.Create(dst)
		if err != nil {
			return err
		}
		_ = f.Close()
		stage = "mount-device"
		if err := unix.Mount(filepath.Join("/dev", name), dst, "", unix.MS_BIND, ""); err != nil {
			return err
		}
	}
	stage = "payload-passwd"
	if err := os.WriteFile(filepath.Join(root, "etc/passwd"), []byte("dify:x:0:0::/home/dify:/bin/sh\n"), 0644); err != nil {
		return err
	}
	stage = "mount-snapshot"
	if err := readonlyBind(cfg.Snapshot, filepath.Join(root, "base")); err != nil {
		return err
	}
	remaining := cfg.Spec.Limits.DiskBytes / 2
	stage = "copy-home"
	if err := copyTree(cfg.Snapshot, filepath.Join(root, "home/dify"), &remaining); err != nil {
		return err
	}
	stage = "copy-inputs"
	for ref, source := range cfg.Inputs {
		if err := copyTree(source, filepath.Join(root, "inputs", ref), &remaining); err != nil {
			return err
		}
	}
	stage = "mount-inputs"
	if err := readonlyBind(filepath.Join(root, "inputs"), filepath.Join(root, "inputs")); err != nil {
		return err
	}
	// All spool files share one finite tmpfs. SQLite and immutable scope identity
	// remain on the persistent private state volume outside the payload chroot.
	spool := filepath.Join(cfg.Directory, "spool")
	stage = "spool-directory"
	if err := os.Mkdir(spool, 0700); err != nil {
		return err
	}
	stage = "mount-spool-tmpfs"
	if err := unix.Mount("tmpfs", spool, "tmpfs", unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC, fmt.Sprintf("size=%d,nr_inodes=8192,mode=0700", cfg.Spec.Limits.OutputBytes+cfg.Spec.Limits.InputBytes+1<<20)); err != nil {
		return err
	}
	return nil
}
func readonlyBind(source, target string) error {
	if err := unix.Mount(source, target, "", unix.MS_BIND, ""); err != nil {
		return WorkerSetupFailure("bind", err)
	}
	return WorkerSetupFailure("remount-readonly", unix.Mount("", target, "", unix.MS_BIND|unix.MS_REMOUNT|unix.MS_RDONLY|unix.MS_NOSUID|unix.MS_NODEV, ""))
}
func copyTree(source, target string, remaining *int64) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return errors.New("snapshot symlinks are forbidden")
	}
	if info.IsDir() {
		if err = os.MkdirAll(target, 0700); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err = copyTree(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name()), remaining); err != nil {
				return err
			}
		}
		return nil
	}
	if !info.Mode().IsRegular() || info.Size() > *remaining {
		return errors.New("source exceeds scope input disk budget")
	}
	*remaining -= info.Size()
	src, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	dst, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, info.Mode().Perm()&0777)
	if err != nil {
		return err
	}
	_, err = io.CopyN(dst, src, info.Size())
	closeErr := dst.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// PrepareJob creates a child-only filesystem view, then drops capabilities and
// applies fatal Landlock restrictions. Script environment cannot select policy.
func PrepareJob(cfg WorkerConfig, scriptPath string) (string, error) {
	script, err := os.ReadFile(scriptPath)
	if err != nil {
		return "", err
	}
	if int64(len(script)) > cfg.Spec.Limits.InputBytes {
		return "", errors.New("script input bound exceeded")
	}
	root := filepath.Join(cfg.Directory, "payload")
	if err = unix.Mount("", "/", "", unix.MS_REC|unix.MS_PRIVATE, ""); err != nil {
		return "", err
	}
	if err = unix.Mount("tmpfs", filepath.Join(root, ".job"), "tmpfs", unix.MS_NOSUID|unix.MS_NODEV, fmt.Sprintf("size=%d,nr_inodes=8", cfg.Spec.Limits.InputBytes+4096)); err != nil {
		return "", err
	}
	if err = os.WriteFile(filepath.Join(root, ".job/script"), script, 0700); err != nil {
		return "", err
	}
	if err = unix.Mount("proc", filepath.Join(root, "proc"), "proc", unix.MS_NOSUID|unix.MS_NODEV|unix.MS_NOEXEC, ""); err != nil {
		return "", err
	}
	if err = unix.Chroot(root); err != nil {
		return "", err
	}
	if err = os.Chdir("/workspace"); err != nil {
		return "", err
	}
	for resource, value := range map[int]uint64{unix.RLIMIT_NOFILE: cfg.Spec.Limits.FDs, unix.RLIMIT_FSIZE: uint64(cfg.Spec.Limits.OutputBytes), unix.RLIMIT_CORE: 0} {
		if err = unix.Setrlimit(resource, &unix.Rlimit{Cur: value, Max: value}); err != nil {
			return "", err
		}
	}
	for capability := 0; capability <= 40; capability++ {
		if err = unix.Prctl(unix.PR_CAPBSET_DROP, uintptr(capability), 0, 0, 0); err != nil {
			return "", err
		}
	}
	caps := [2]unix.CapUserData{}
	if err = unix.Capset(&unix.CapUserHeader{Version: unix.LINUX_CAPABILITY_VERSION_3}, &caps[0]); err != nil {
		return "", err
	}
	if err = unix.Prctl(unix.PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); err != nil {
		return "", err
	}
	if err = RestrictJobSyscalls(); err != nil {
		return "", err
	}
	if err = landlock.Restrict((Scope{Spec: cfg.Spec}).LandlockConfig()); err != nil {
		return "", fmt.Errorf("native test scope isolation: %w", err)
	}
	return "/.job/script", nil
}

// VerifyBootstrapPolicy requires actual enforcing LSM/seccomp state, not merely
// profile files or advertised settings. Namespace and Landlock probes follow.
func VerifyBootstrapPolicy() error {
	mode, err := unix.PrctlRetInt(unix.PR_GET_SECCOMP, 0, 0, 0, 0)
	if err != nil || mode != 2 {
		return errors.New("native supervisor requires active seccomp filtering")
	}
	profile, err := os.ReadFile("/proc/self/attr/current")
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(profile)) != "dify-native-test-supervisor (enforce)" {
		return errors.New("native supervisor requires enforcing AppArmor profile")
	}
	// PTRACE_TRACEME needs no capabilities for an ordinary process. Its denial is
	// an executable policy canary, independent of filesystem namespace probes.
	_, _, errno := unix.RawSyscall6(unix.SYS_PTRACE, 0, 0, 0, 0, 0, 0)
	if errno != unix.EPERM {
		return errors.New("native seccomp ptrace canary was not denied")
	}
	return nil
}
