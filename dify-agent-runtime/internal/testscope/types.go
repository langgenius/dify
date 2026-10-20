// Package testscope owns immutable, bounded native-test Linux scopes. It never
// interprets an approval: only an authenticated owner can create a scope.
package testscope

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/langgenius/dify/dify-agent-runtime/internal/landlock"
)

var safeID = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$`)
var ErrUnavailable = errors.New("native_scope_unavailable")
var ErrUnauthorized = errors.New("native_scope_unauthorized")

type Limits struct {
	CPUQuota    int64  `json:"cpu_quota"` // microseconds per 100ms period
	MemoryBytes int64  `json:"memory_bytes"`
	PIDs        int64  `json:"pids"`
	FDs         uint64 `json:"fds"`
	WallSeconds int64  `json:"wall_seconds"`
	InputBytes  int64  `json:"input_bytes"`
	OutputBytes int64  `json:"output_bytes"`
	DiskBytes   int64  `json:"disk_bytes"`
}

func (l Limits) Validate() error {
	if l.CPUQuota < 1000 || l.CPUQuota > 800000 || l.MemoryBytes < 64<<20 || l.MemoryBytes > 8<<30 || l.PIDs < 8 || l.PIDs > 512 || l.FDs < 32 || l.FDs > 4096 || l.WallSeconds < 1 || l.WallSeconds > 3600 || l.InputBytes < 1 || l.InputBytes > 16<<20 || l.OutputBytes < 4096 || l.OutputBytes > 64<<20 || l.DiskBytes < 1<<20 || l.DiskBytes > 1<<30 {
		return errors.New("all scope limits must be finite and within supervisor bounds")
	}
	return nil
}

type NetworkTarget struct {
	Host           string `json:"host"`
	Port           uint16 `json:"port"`
	MaxBytes       int64  `json:"max_bytes"`
	TimeoutSeconds int64  `json:"timeout_seconds"`
}

func (n NetworkTarget) Matches(authority string) bool {
	return authority == net.JoinHostPort(n.Host, strconv.Itoa(int(n.Port)))
}

type NativeScopeSpec struct {
	ScopeID          string          `json:"scope_id"`
	Generation       int64           `json:"generation"`
	BindingRef       string          `json:"binding_ref"`
	BaseSnapshotRef  string          `json:"base_snapshot_ref"`
	InputFileRefs    []string        `json:"input_file_refs"`
	CapabilityDigest string          `json:"capability_digest"`
	Deadline         time.Time       `json:"deadline"`
	Limits           Limits          `json:"limits"`
	NetworkTargets   []NetworkTarget `json:"network_targets"`
}

func (s NativeScopeSpec) Validate() error {
	for _, v := range append([]string{s.ScopeID, s.BindingRef, s.BaseSnapshotRef}, s.InputFileRefs...) {
		if !safeID.MatchString(v) {
			return errors.New("invalid immutable reference")
		}
	}
	if s.Generation < 1 || len(s.CapabilityDigest) != 64 || len(s.InputFileRefs) > 64 || len(s.NetworkTargets) > 16 {
		return errors.New("invalid scope identity")
	}
	if _, err := hex.DecodeString(s.CapabilityDigest); err != nil {
		return errors.New("invalid capability digest")
	}
	if err := s.Limits.Validate(); err != nil {
		return err
	}
	remaining := time.Until(s.Deadline)
	if remaining <= 0 || remaining > time.Duration(s.Limits.WallSeconds)*time.Second {
		return errors.New("deadline exceeds wall budget")
	}
	seen := map[string]bool{}
	for _, n := range s.NetworkTargets {
		if n.Host == "" || strings.ContainsAny(n.Host, "/@\\ :\x00") || n.Host != strings.ToLower(n.Host) || n.Port == 0 || n.MaxBytes < 1 || n.MaxBytes > 16<<20 || n.TimeoutSeconds < 1 || n.TimeoutSeconds > 60 || seen[n.Host+":"+strconv.Itoa(int(n.Port))] {
			return errors.New("invalid or duplicate bounded network target")
		}
		seen[n.Host+":"+strconv.Itoa(int(n.Port))] = true
	}
	return nil
}

type Scope struct {
	Spec      NativeScopeSpec `json:"spec"`
	TokenHash string          `json:"-"`
	Network   PinnedNetwork   `json:"-"`
	Status    string          `json:"status"`
	PID       int             `json:"-"`
	StartTime string          `json:"-"`
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func (s Scope) Authorize(generation int64, token string) error {
	if token == "" || generation != s.Spec.Generation || subtle.ConstantTimeCompare([]byte(HashToken(token)), []byte(s.TokenHash)) != 1 {
		return ErrUnauthorized
	}
	if s.Status != "ready" || !s.Spec.Deadline.After(time.Now()) {
		return ErrUnavailable
	}
	return nil
}
func (s Scope) LandlockConfig() *landlock.Config {
	return &landlock.Config{Home: "/home/dify", Cwd: "/workspace", JobDir: "/.job", ROPaths: []string{"/usr", "/bin", "/lib", "/lib64", "/etc", "/inputs"}, RWPaths: []string{"/tmp"}, RWDevPaths: []string{"/dev/null", "/dev/zero", "/dev/urandom", "/dev/random", "/dev/tty"}}
}

type HostCapabilities struct{ UserNamespaces, MountNamespaces, PIDNamespaces, NetworkNamespaces, Landlock, DelegatedCgroup bool }

func ValidateHostCapabilities(c HostCapabilities) error {
	if !c.UserNamespaces || !c.MountNamespaces || !c.PIDNamespaces || !c.NetworkNamespaces || !c.Landlock || !c.DelegatedCgroup {
		return fmt.Errorf("%w: user/mount/PID/network namespaces, Landlock and delegated cgroup v2 are required", ErrUnavailable)
	}
	return nil
}

func ValidateJob(cwd string, env map[string]string) error {
	if cwd != "/workspace" {
		return errors.New("native job cwd must be /workspace")
	}
	for k := range env {
		if strings.HasPrefix(k, "SHELLCTL_") || strings.HasPrefix(k, "LD_") || strings.HasPrefix(k, "DYLD_") {
			return errors.New("native job cannot alter supervisor policy")
		}
		switch k {
		case "HOME", "PATH", "TMUX", "BASH_ENV", "ENV", "IFS", "TMP", "TEMP", "TMPDIR":
			return errors.New("native job cannot alter trusted environment")
		}
	}
	return nil
}
