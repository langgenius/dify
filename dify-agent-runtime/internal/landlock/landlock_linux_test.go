//go:build linux

package landlock

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"syscall"
	"testing"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
	ll "github.com/landlock-lsm/go-landlock/landlock/syscall"
)

func TestBuildRulesScopesReferToHomeAndCwd(t *testing.T) {
	for _, cwdMode := range []string{"separate", "home", "empty"} {
		t.Run(cwdMode, func(t *testing.T) {
			home := t.TempDir()
			cwd := t.TempDir()
			extra := t.TempDir()
			readOnly := t.TempDir()
			jobDir := t.TempDir()
			device := filepath.Join(extra, "device")
			if err := os.WriteFile(device, nil, 0600); err != nil {
				t.Fatal(err)
			}
			missing := filepath.Join(extra, "missing")
			referDirs := []string{home}
			switch cwdMode {
			case "separate":
				referDirs = append(referDirs, cwd)
			case "home":
				cwd = home
			case "empty":
				cwd = ""
			}
			cfg := &Config{
				Home:       home,
				Cwd:        cwd,
				JobDir:     jobDir,
				RWPaths:    []string{extra, missing},
				ROPaths:    []string{readOnly, missing},
				RWDevPaths: []string{device, missing},
			}
			want := []golandlock.Rule{
				golandlock.RWDirs(referDirs...).WithRefer(),
				golandlock.RWDirs(extra),
				golandlock.RODirs(readOnly, jobDir),
				golandlock.RWFiles(device),
			}
			if got := buildRules(cfg, true); !reflect.DeepEqual(got, want) {
				t.Errorf("rules = %v, want %v", got, want)
			}
		})
	}
}

func TestBuildRulesWithoutRefer(t *testing.T) {
	home := t.TempDir()
	cwd := t.TempDir()
	cfg := &Config{Home: home, Cwd: cwd}
	want := []golandlock.Rule{golandlock.RWDirs(home, cwd)}
	if got := buildRules(cfg, false); !reflect.DeepEqual(got, want) {
		t.Errorf("rules = %v, want %v", got, want)
	}
}

func TestBuildRulesWithoutExtraPaths(t *testing.T) {
	home := t.TempDir()
	cfg := &Config{Home: home, Cwd: home}
	want := []golandlock.Rule{golandlock.RWDirs(home).WithRefer()}
	if got := buildRules(cfg, true); !reflect.DeepEqual(got, want) {
		t.Errorf("rules = %v, want %v", got, want)
	}
}

func TestRestrictV1Fallback(t *testing.T) {
	skipIfNoRealLandlock(t)
	outside := t.TempDir()
	output, err := runRestrictHelper(t, outside, "1")
	if err != nil {
		t.Fatalf("helper failed: %v\n%s", err, output)
	}
}

func TestRestrictV2Refer(t *testing.T) {
	skipIfNoRealLandlock(t)
	outside := t.TempDir()
	output, err := runRestrictHelper(t, outside, "real")
	if err != nil {
		t.Fatalf("helper failed: %v\n%s", err, output)
	}
}

func skipIfNoRealLandlock(t *testing.T) {
	t.Helper()
	abi, err := ll.LandlockGetABIVersion()
	if err != nil || abi < 2 {
		t.Skipf("need real Landlock ABI >= 2 to enforce rules, got abi=%d err=%v", abi, err)
	}
}

func runRestrictHelper(t *testing.T, outside, abi string) ([]byte, error) {
	t.Helper()
	home := t.TempDir()
	cmd := exec.Command(os.Args[0], "-test.run=^TestRestrictHelperProcess$",
		"--", home, outside)
	cmd.Env = append(os.Environ(),
		"SHELLCTL_RESTRICT_HELPER=1",
		"SHELLCTL_RESTRICT_HELPER_ABI="+abi,
	)
	return cmd.CombinedOutput()
}

func TestRestrictHelperProcess(t *testing.T) {
	if os.Getenv("SHELLCTL_RESTRICT_HELPER") != "1" {
		return
	}
	if len(os.Args) != 5 || os.Args[2] != "--" {
		t.Fatalf("unexpected helper arguments: %q", os.Args)
	}
	home, outside := os.Args[3], os.Args[4]
	switch abi := os.Getenv("SHELLCTL_RESTRICT_HELPER_ABI"); abi {
	case "real":
	default:
		forced, err := strconv.Atoi(abi)
		if err != nil {
			t.Fatalf("invalid abi %q: %v", abi, err)
		}
		getABIVersion = func() (int, error) { return forced, nil }
	}
	if err := Restrict(&Config{Home: home, Cwd: home}); err != nil {
		t.Fatalf("Restrict: %v", err)
	}

	dirA := filepath.Join(home, "a")
	dirB := filepath.Join(home, "b")
	for _, dir := range []string{dirA, dirB} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	src := filepath.Join(dirA, "f")
	if err := os.WriteFile(src, []byte("x"), 0600); err != nil {
		t.Fatalf("write inside home: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outside, "denied"), nil, 0600); !errors.Is(err, syscall.EACCES) {
		t.Fatalf("write outside home err = %v, want EACCES", err)
	}
	if err := os.Rename(src, filepath.Join(dirA, "g")); err != nil {
		t.Fatalf("same-dir rename inside home: %v", err)
	}
	src = filepath.Join(dirA, "g")
	dst := filepath.Join(dirB, "g")
	// Link first: a successful rename moves src out from under a later link.
	linkErr := os.Link(src, dst)
	renameErr := os.Rename(src, dst)
	if os.Getenv("SHELLCTL_RESTRICT_HELPER_ABI") == "1" {
		if !errors.Is(renameErr, syscall.EXDEV) {
			t.Fatalf("cross-dir rename err = %v, want EXDEV", renameErr)
		}
		if !errors.Is(linkErr, syscall.EXDEV) {
			t.Fatalf("cross-dir link err = %v, want EXDEV", linkErr)
		}
		return
	}
	if renameErr != nil {
		t.Fatalf("cross-dir rename inside home: %v", renameErr)
	}
	if linkErr != nil {
		t.Fatalf("cross-dir link inside home: %v", linkErr)
	}
}
