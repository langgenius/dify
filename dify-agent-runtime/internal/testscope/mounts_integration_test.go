//go:build linux && integration && native_scope

package testscope

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// TestReadonlyBindInheritedMounts is a strict, root-provisioned kernel component
// test, separate from the enforcing production-profile integration cases. The
// root fixture only mounts synthetic bounded filesystems in its own private
// mount/network namespaces. No namespace or privilege prerequisite is skipped.
func TestReadonlyBindInheritedMounts(t *testing.T) {
	uid, err := strconv.Atoi(os.Getenv("NATIVE_MOUNT_TEST_UID"))
	if err != nil || uid <= 0 {
		t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: dedicated UID required")
	}
	gid, err := strconv.Atoi(os.Getenv("NATIVE_MOUNT_TEST_GID"))
	if err != nil || gid <= 0 {
		t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: dedicated GID required")
	}
	stage := os.Getenv("NATIVE_MOUNT_TEST_STAGE")
	root := os.Getenv("NATIVE_MOUNT_TEST_ROOT")
	check := func(stage string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("NATIVE_MOUNT_FIXTURE_ERROR: %s", WorkerSetupFailure(stage, err))
		}
	}
	if stage == "" {
		if os.Geteuid() != 0 {
			t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: ancestor provisioning requires root")
		}
		// Applied before helper launch, and inherited by both bounded helpers.
		for resource, maximum := range map[int]uint64{
			unix.RLIMIT_AS: 4 << 30, unix.RLIMIT_CPU: 20, unix.RLIMIT_FSIZE: 1 << 20,
			unix.RLIMIT_NOFILE: 128, unix.RLIMIT_NPROC: 128, unix.RLIMIT_CORE: 0,
		} {
			check("fixture-limit", unix.Setrlimit(resource, &unix.Rlimit{Cur: maximum, Max: maximum}))
		}
		root, err = os.MkdirTemp(os.TempDir(), "native-mount-")
		check("fixture-temp", err)
		t.Cleanup(func() { _ = os.RemoveAll(root) })
		check("fixture-traversal", os.Chmod(root, 0755))
		runMountFixtureHelper(t, "prepare", root, uid, gid, &syscall.SysProcAttr{
			Cloneflags: unix.CLONE_NEWNS | unix.CLONE_NEWNET, Pdeathsig: unix.SIGKILL,
		})
		return
	}
	if root == "" || !filepath.IsAbs(root) {
		t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: synthetic fixture root required")
	}
	source, target := filepath.Join(root, "source"), filepath.Join(root, "target")
	cover := filepath.Join(source, "cover")
	switch stage {
	case "prepare":
		// First operation in the cloned mount namespace prevents propagation of
		// the following synthetic mounts to the CI host or service namespace.
		check("fixture-private", unix.Mount("", "/", "", unix.MS_REC|unix.MS_PRIVATE, ""))
		check("fixture-source", os.Mkdir(source, 0755))
		check("fixture-target", os.Mkdir(target, 0755))
		check("fixture-source-tmpfs", unix.Mount("tmpfs", source, "tmpfs", 0, "size=4194304,nr_inodes=128,mode=0755"))
		check("fixture-cover-directory", os.Mkdir(cover, 0755))
		check("fixture-lower-file", os.WriteFile(filepath.Join(cover, "hidden-lower"), []byte("LOWER_CANARY"), 0644))
		check("fixture-root-file", os.WriteFile(filepath.Join(source, "visible-root"), []byte("ROOT_CANARY"), 0644))
		check("fixture-cover-tmpfs", unix.Mount("tmpfs", cover, "tmpfs", unix.MS_NOEXEC|unix.MS_NOATIME, "size=4194304,nr_inodes=128,mode=0755"))
		check("fixture-cover-file", os.WriteFile(filepath.Join(cover, "visible-cover"), []byte("COVER_CANARY"), 0644))
		// A write failure must be EROFS, not a DAC artifact of root-owned files.
		check("fixture-root-mode", os.Chmod(filepath.Join(source, "visible-root"), 0666))
		check("fixture-cover-mode", os.Chmod(filepath.Join(cover, "visible-cover"), 0666))
		runMountFixtureHelper(t, "child", root, uid, gid, &syscall.SysProcAttr{
			Cloneflags:                 unix.CLONE_NEWUSER | unix.CLONE_NEWNS,
			UidMappings:                []syscall.SysProcIDMap{{ContainerID: 0, HostID: uid, Size: 1}},
			GidMappings:                []syscall.SysProcIDMap{{ContainerID: 0, HostID: gid, Size: 1}},
			GidMappingsEnableSetgroups: false,
			Credential:                 &syscall.Credential{Uid: 0, Gid: 0, NoSetGroups: true}, Pdeathsig: unix.SIGKILL,
		})
	case "child":
		if os.Geteuid() != 0 {
			t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: child user mapping failed")
		}
		check("fixture-child-private", unix.Mount("", "/", "", unix.MS_REC|unix.MS_PRIVATE, ""))
		visible, err := os.ReadFile(filepath.Join(cover, "visible-cover"))
		check("fixture-visible-cover", err)
		if string(visible) != "COVER_CANARY" {
			t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: covering mount not visible")
		}
		if _, err := os.Stat(filepath.Join(cover, "hidden-lower")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: lower canary not hidden")
		}
		// Prove writable source files without relying on namespace-root DAC.
		check("fixture-root-writable", os.WriteFile(filepath.Join(source, "visible-root"), []byte("ROOT_CANARY"), 0666))
		check("fixture-cover-writable", os.WriteFile(filepath.Join(cover, "visible-cover"), []byte("COVER_CANARY"), 0666))
		// This is the required reproducer, not a setup-denial-as-RED shortcut.
		if err := unix.Mount(source, target, "", unix.MS_BIND, ""); !errors.Is(err, unix.EINVAL) {
			t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: plain inherited bind did not return EINVAL")
		}
		t.Log("NATIVE_MOUNT_REPRODUCED: covering mount visible, lower hidden, plain bind EINVAL")
		if err := readonlyBind(source, target); err != nil {
			t.Fatalf("NATIVE_MOUNT_PRODUCT_FAILURE: %s", err)
		}
		// Restrict copied mounts only, never the ancestor's source superblock.
		check("original-root-still-writable", os.WriteFile(filepath.Join(source, "visible-root"), []byte("ROOT_CANARY"), 0666))
		check("original-cover-still-writable", os.WriteFile(filepath.Join(cover, "visible-cover"), []byte("COVER_CANARY"), 0666))
		for _, file := range []string{"visible-root", "cover/visible-cover"} {
			if err := os.WriteFile(filepath.Join(target, file), []byte("DENIED"), 0666); !errors.Is(err, unix.EROFS) {
				t.Fatal("NATIVE_MOUNT_PRODUCT_FAILURE: copied mount write did not return EROFS")
			}
		}
		visible, err = os.ReadFile(filepath.Join(target, "cover/visible-cover"))
		check("copied-visible-cover", err)
		if string(visible) != "COVER_CANARY" {
			t.Fatal("NATIVE_MOUNT_PRODUCT_FAILURE: covering content changed")
		}
		if _, err := os.Stat(filepath.Join(target, "cover/hidden-lower")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("NATIVE_MOUNT_PRODUCT_FAILURE: covered lower data exposed")
		}
		for _, mountpoint := range []string{target, filepath.Join(target, "cover")} {
			var st unix.Statfs_t
			check("copied-mount-flags", unix.Statfs(mountpoint, &st))
			flags := uint64(unix.ST_RDONLY | unix.ST_NOSUID | unix.ST_NODEV)
			if mountpoint != target {
				flags |= unix.ST_NOEXEC | unix.ST_NOATIME
			}
			if uint64(st.Flags)&flags != flags {
				t.Fatal("NATIVE_MOUNT_PRODUCT_FAILURE: copied mount lost required flags")
			}
		}
		t.Log("NATIVE_MOUNT_CONFORMANT: root and cover EROFS; lower hidden; all fixture mounts readonly,nosuid,nodev; cover noexec,noatime retained")
	default:
		t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: unknown helper stage")
	}
}

func runMountFixtureHelper(t *testing.T, stage, root string, uid, gid int, attr *syscall.SysProcAttr) {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal("NATIVE_MOUNT_FIXTURE_ERROR: fixture executable unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, self, "-test.run=^TestReadonlyBindInheritedMounts$", "-test.v")
	cmd.Env = []string{
		"PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C", "GOMAXPROCS=2", "GOMEMLIMIT=128MiB",
		"TMPDIR=" + os.TempDir(), "NATIVE_MOUNT_TEST_STAGE=" + stage, "NATIVE_MOUNT_TEST_ROOT=" + root,
		"NATIVE_MOUNT_TEST_UID=" + strconv.Itoa(uid), "NATIVE_MOUNT_TEST_GID=" + strconv.Itoa(gid),
	}
	cmd.SysProcAttr = attr
	output, err := cmd.CombinedOutput()
	// Forward only our synthetic test markers, never helper argv/env or other
	// process output. The markers have no paths, mount sources, or user content.
	for _, line := range strings.Split(string(output), "\n") {
		if pos := strings.Index(line, "NATIVE_MOUNT_"); pos >= 0 {
			t.Log(line[pos:])
		}
	}
	if err != nil {
		t.Fatal("NATIVE_MOUNT_FIXTURE_CHILD_FAILED: see bounded stage markers above")
	}
}
