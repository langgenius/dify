//go:build linux

package landlock

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	golandlock "github.com/landlock-lsm/go-landlock/landlock"
)

func TestBuildRulesScopesReferToHomeAndCwd(t *testing.T) {
	for _, cwdMode := range []string{"separate", "home", "empty"} {
		t.Run(cwdMode, func(t *testing.T) {
			root := t.TempDir()
			home := filepath.Join(root, "home")
			cwd := filepath.Join(root, "workspace")
			extra := filepath.Join(root, "shared")
			readOnly := filepath.Join(root, "read-only")
			jobDir := filepath.Join(root, "job")
			for _, path := range []string{home, cwd, extra, readOnly, jobDir} {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			device := filepath.Join(root, "device")
			if err := os.WriteFile(device, nil, 0600); err != nil {
				t.Fatal(err)
			}
			missing := filepath.Join(root, "missing")
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
			if got := buildRules(cfg); !reflect.DeepEqual(got, want) {
				t.Errorf("rules = %v, want %v", got, want)
			}
		})
	}
}

func TestBuildRulesWithoutExtraPaths(t *testing.T) {
	home := t.TempDir()
	cfg := &Config{Home: home, Cwd: home}
	want := []golandlock.Rule{golandlock.RWDirs(home).WithRefer()}
	if got := buildRules(cfg); !reflect.DeepEqual(got, want) {
		t.Errorf("rules = %v, want %v", got, want)
	}
}
