//go:build linux

package testscope

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
	"unsafe"
)

func ValidateDelegation(root string) error {
	var st unix.Statfs_t
	if err := unix.Statfs(root, &st); err != nil {
		return err
	}
	if st.Type != unix.CGROUP2_SUPER_MAGIC {
		return errors.New("delegation is not cgroup v2")
	}
	controllers, err := os.ReadFile(filepath.Join(root, "cgroup.subtree_control"))
	if err != nil {
		return err
	}
	for _, c := range []string{"cpu", "memory", "pids"} {
		if !strings.Contains(" "+strings.TrimSpace(string(controllers))+" ", " "+c+" ") {
			return fmt.Errorf("missing delegated %s controller", c)
		}
	}
	// A dedicated delegated parent must have finite resource ceilings itself.
	for _, name := range []string{"memory.max", "pids.max", "cpu.max"} {
		b, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			return err
		}
		if strings.HasPrefix(strings.TrimSpace(string(b)), "max") {
			return fmt.Errorf("unbounded delegated parent %s", name)
		}
	}
	return nil
}
func createCgroup(root, id string, l Limits) (string, error) {
	if err := ValidateDelegation(root); err != nil {
		return "", err
	}
	if !safeID.MatchString(id) {
		return "", errors.New("invalid cgroup identity")
	}
	path := filepath.Join(root, id)
	if err := os.Mkdir(path, 0700); err != nil {
		return "", err
	}
	good := false
	defer func() {
		if !good {
			_ = os.Remove(path)
		}
	}()
	for name, value := range map[string]string{"cpu.max": fmt.Sprintf("%d 100000", l.CPUQuota), "memory.max": strconv.FormatInt(l.MemoryBytes, 10), "memory.swap.max": "0", "memory.oom.group": "1", "pids.max": strconv.FormatInt(l.PIDs, 10)} {
		if err := os.WriteFile(filepath.Join(path, name), []byte(value), 0600); err != nil {
			return "", err
		}
	}
	f, err := os.OpenFile(filepath.Join(path, "cgroup.kill"), os.O_WRONLY, 0)
	if err != nil {
		return "", err
	}
	_ = f.Close()
	good = true
	return path, nil
}

// KillCgroup returns success only after the kernel reports every descendant gone.
func KillCgroup(path string, timeout time.Duration) error {
	if err := os.WriteFile(filepath.Join(path, "cgroup.kill"), []byte("1"), 0600); err != nil {
		return err
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		b, err := os.ReadFile(filepath.Join(path, "cgroup.events"))
		if err != nil {
			return err
		}
		if strings.Contains(string(b), "populated 0") {
			return nil
		}
		time.Sleep(10 * time.Millisecond)
	}
	return errors.New("scope cleanup timeout: quarantined")
}

// CheckOutputSpool counts public stdout and protected stderr together. The
// tmpfs is the hard disk ceiling; this lower aggregate ceiling rejects overflow
// before a completed job can be reported as success.
func CheckOutputSpool(root string, maximum int64) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	var total int64
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		for _, name := range []string{"output.log", "stderr.log"} {
			info, err := os.Stat(filepath.Join(root, entry.Name(), name))
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return err
			}
			total += info.Size()
			if total > maximum {
				return errors.New("native_scope_output_limit_exceeded")
			}
		}
	}
	return nil
}

// OpenOutputBudget uses the existing worker SQLite catalog, not an independent
// execution owner. Both PTY and stdio writers share the same immutable budget.
func OpenOutputBudget(configPath string, destination io.Writer) (io.Writer, func(), error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, nil, err
	}
	var cfg WorkerConfig
	if err = json.Unmarshal(data, &cfg); err != nil {
		return nil, nil, err
	}
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=synchronous(FULL)", filepath.Join(cfg.Directory, "state", "shellctl.db")))
	if err != nil {
		return nil, nil, err
	}
	db.SetMaxOpenConns(1)
	writer := NewBudgetWriter(destination, NewSQLStore(db), cfg.Spec.ScopeID, "output", func() {
		_ = os.WriteFile(filepath.Join(cfg.Directory, "violation"), []byte("native_scope_output_limit_exceeded"), 0600)
	})
	return writer, func() { _ = db.Close() }, nil
}

// RestrictJobSyscalls layers a job-only filter over the trusted bootstrap
// allowlist. In particular, unprivileged nested user namespaces must not regain
// mount capabilities and create unmetered tmpfs mounts after setup.
func RestrictJobSyscalls() error {
	filters := []unix.SockFilter{{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 0}}
	denied := []uint32{unix.SYS_UNSHARE, unix.SYS_SETNS, unix.SYS_MOUNT, unix.SYS_UMOUNT2, unix.SYS_PIVOT_ROOT, unix.SYS_CHROOT, unix.SYS_CAPSET, unix.SYS_OPEN_TREE, unix.SYS_MOVE_MOUNT, unix.SYS_FSOPEN, unix.SYS_FSCONFIG, unix.SYS_FSMOUNT, unix.SYS_FSPICK, unix.SYS_MOUNT_SETATTR}
	for _, nr := range denied {
		filters = append(filters, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, K: nr, Jf: 1}, unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | uint32(unix.EPERM)})
	}
	// ENOSYS lets libc fall back to clone for ordinary threads without permitting
	// clone3's pointer-based namespace flags to bypass the inspectable clone filter.
	filters = append(filters,
		unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, K: unix.SYS_CLONE3, Jf: 1},
		unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | uint32(unix.ENOSYS)},
	)
	filters = append(filters,
		unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K, K: unix.SYS_CLONE, Jf: 3},
		unix.SockFilter{Code: unix.BPF_LD | unix.BPF_W | unix.BPF_ABS, K: 16},
		unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JSET | unix.BPF_K, K: unix.CLONE_NEWUSER | unix.CLONE_NEWNS | unix.CLONE_NEWPID | unix.CLONE_NEWNET | unix.CLONE_NEWIPC | unix.CLONE_NEWUTS | unix.CLONE_NEWCGROUP, Jf: 1},
		unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ERRNO | uint32(unix.EPERM)},
		unix.SockFilter{Code: unix.BPF_RET | unix.BPF_K, K: unix.SECCOMP_RET_ALLOW},
	)
	program := unix.SockFprog{Len: uint16(len(filters)), Filter: &filters[0]}
	err := unix.Prctl(unix.PR_SET_SECCOMP, unix.SECCOMP_MODE_FILTER, uintptr(unsafe.Pointer(&program)), 0, 0)
	runtime.KeepAlive(filters)
	return err
}
