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
	"strconv"
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

// readonlyBind runs during the single-owner bootstrap, after recursive private
// propagation and before any jobs. Recursive bind preserves inherited covers;
// remounting only the top would leave copied child mounts writable.
func readonlyBind(source, target string) error {
	if err := unix.Mount(source, target, "", unix.MS_BIND|unix.MS_REC, ""); err != nil {
		return WorkerSetupFailure("bind-recursive", err)
	}
	rootID, err := mountID(target)
	if err != nil {
		return WorkerSetupFailure("copied-mount-id", err)
	}
	before, err := readMountTree(rootID, target)
	if err != nil {
		return WorkerSetupFailure("copied-mount-tree", err)
	}
	for _, mount := range before {
		// With no atime bits specified, Linux preserves all existing atime
		// flags on a bind remount. Preserve noexec explicitly as well.
		flags := uintptr(unix.MS_BIND | unix.MS_REMOUNT | unix.MS_RDONLY | unix.MS_NOSUID | unix.MS_NODEV)
		flags |= mount.flags & unix.MS_NOEXEC
		if err := unix.Mount("", mount.path, "", flags, ""); err != nil {
			return WorkerSetupFailure("remount-readonly", err)
		}
	}
	afterID, err := mountID(target)
	if err != nil {
		return WorkerSetupFailure("verify-mount-id", err)
	}
	if afterID != rootID {
		return WorkerSetupFailure("verify-mount-id", errors.New("copied root changed"))
	}
	after, err := readMountTree(rootID, target)
	if err != nil {
		return WorkerSetupFailure("verify-mount-tree", err)
	}
	if err := verifyReadonlyMountTree(before, after); err != nil {
		return WorkerSetupFailure("verify-readonly", err)
	}
	return nil
}

const (
	maxMountInfoBytes   = 1 << 20
	maxMountInfoEntries = 4096
	maxCopiedMounts     = 256
)

type copiedMount struct {
	id, parent uint64
	path       string
	flags      uintptr
}

func mountID(path string) (uint64, error) {
	var st unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_MNT_ID, &st); err != nil {
		return 0, err
	}
	if st.Mask&unix.STATX_MNT_ID == 0 || st.Mnt_id == 0 {
		return 0, errors.New("mount identity unavailable")
	}
	return st.Mnt_id, nil
}

func readMountTree(rootID uint64, target string) ([]copiedMount, error) {
	f, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	data, err := io.ReadAll(io.LimitReader(f, maxMountInfoBytes+1))
	if err != nil {
		return nil, err
	}
	return parseMountTree(data, rootID, target)
}

// parseMountTree follows mount IDs so pre-existing mounts at the same target
// are not mistaken for the copied root. Stacked mounts within the copied tree
// are refused because pathname remounts cannot address their hidden layers.
func parseMountTree(data []byte, rootID uint64, target string) ([]copiedMount, error) {
	invalid := errors.New("unverifiable copied mount tree")
	if len(data) > maxMountInfoBytes || !filepath.IsAbs(target) || filepath.Clean(target) != target || target == "/" {
		return nil, invalid
	}
	entries := make(map[uint64]copiedMount)
	children := make(map[uint64][]uint64)
	options := make(map[uint64]string)
	private := make(map[uint64]bool)
	for _, line := range strings.Split(strings.TrimSuffix(string(data), "\n"), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 || len(entries) >= maxMountInfoEntries {
			return nil, invalid
		}
		separator := -1
		for i := 6; i < len(fields); i++ {
			if fields[i] == "-" {
				separator = i
				break
			}
		}
		if separator < 6 || len(fields) != separator+4 {
			return nil, invalid
		}
		id, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil || id == 0 {
			return nil, invalid
		}
		parent, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return nil, invalid
		}
		if _, exists := entries[id]; exists {
			return nil, invalid
		}
		path, err := mountInfoPath(fields[4])
		if err != nil {
			return nil, invalid
		}
		entries[id] = copiedMount{id: id, parent: parent, path: path}
		children[parent] = append(children[parent], id)
		options[id] = fields[5]
		private[id] = separator == 6
	}
	root, exists := entries[rootID]
	if !exists || root.path != target {
		return nil, invalid
	}
	seen := make(map[uint64]bool)
	paths := make(map[string]bool)
	var result []copiedMount
	var visit func(uint64) error
	visit = func(id uint64) error {
		mount := entries[id]
		if seen[id] || len(seen) >= maxCopiedMounts || paths[mount.path] || !private[id] ||
			(mount.path != target && !strings.HasPrefix(mount.path, target+"/")) {
			return invalid
		}
		seen[id] = true
		paths[mount.path] = true
		flags, err := mountInfoFlags(options[id])
		if err != nil {
			return invalid
		}
		mount.flags = flags
		for _, child := range children[id] {
			if err := visit(child); err != nil {
				return err
			}
		}
		result = append(result, mount) // Children first, then their parent.
		return nil
	}
	if err := visit(rootID); err != nil {
		return nil, err
	}
	return result, nil
}

func mountInfoPath(encoded string) (string, error) {
	var out strings.Builder
	for i := 0; i < len(encoded); i++ {
		if encoded[i] != '\\' {
			out.WriteByte(encoded[i])
			continue
		}
		if i+3 >= len(encoded) {
			return "", errors.New("invalid mount path escape")
		}
		var b byte
		switch encoded[i+1 : i+4] {
		case "040":
			b = ' '
		case "011":
			b = '\t'
		case "012":
			b = '\n'
		case "134":
			b = '\\'
		default:
			return "", errors.New("unknown mount path escape")
		}
		out.WriteByte(b)
		i += 3
	}
	path := out.String()
	if len(path) > 4096 || strings.ContainsRune(path, 0) || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return "", errors.New("invalid mount path")
	}
	return path, nil
}

func mountInfoFlags(options string) (uintptr, error) {
	var flags uintptr
	seen := make(map[string]bool)
	mode := 0
	for _, option := range strings.Split(options, ",") {
		if seen[option] {
			return 0, errors.New("duplicate mount flag")
		}
		seen[option] = true
		switch option {
		case "ro":
			flags |= unix.MS_RDONLY
			mode++
		case "rw":
			mode++
		case "nosuid":
			flags |= unix.MS_NOSUID
		case "nodev":
			flags |= unix.MS_NODEV
		case "noexec":
			flags |= unix.MS_NOEXEC
		case "noatime":
			flags |= unix.MS_NOATIME
		case "nodiratime":
			flags |= unix.MS_NODIRATIME
		case "relatime":
			flags |= unix.MS_RELATIME
		default:
			return 0, errors.New("unknown mount flag")
		}
	}
	if mode != 1 || flags&unix.MS_NOATIME != 0 && flags&unix.MS_RELATIME != 0 {
		return 0, errors.New("invalid mount flag combination")
	}
	return flags, nil
}

func verifyReadonlyMountTree(before, after []copiedMount) error {
	invalid := errors.New("copied mount restrictions not established")
	if len(before) != len(after) {
		return invalid
	}
	required := uintptr(unix.MS_RDONLY | unix.MS_NOSUID | unix.MS_NODEV)
	for i, mount := range before {
		current := after[i]
		if mount.id != current.id || mount.parent != current.parent || mount.path != current.path || current.flags != mount.flags|required {
			return invalid
		}
	}
	return nil
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
