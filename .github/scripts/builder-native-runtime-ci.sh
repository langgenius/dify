#!/usr/bin/env bash
# Provision only an ephemeral normal CI VM. This is not a deployment installer.
set -euo pipefail
umask 077

[[ ${GITHUB_ACTIONS:-} == true && -n ${RUNNER_TEMP:-} && -n ${GITHUB_RUN_ID:-} ]] || {
  echo 'This fixture requires an ephemeral GitHub Actions runner.' >&2
  exit 1
}
unit=dify-native.service
marker=/run/dify-native-ci-owner
owner="${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT:-1}"

owned_fixture() {
  [[ $(sudo cat "$marker" 2>/dev/null) == "$owner" ]]
}

require_manager_subgroup_support() {
  local native_systemd_version
  native_systemd_version=$(systemctl show --property=Version --value)
  [[ $native_systemd_version =~ ^([0-9]+) ]]
  (( BASH_REMATCH[1] >= 254 )) || {
    echo 'Native host profile requires systemd 254 or newer.' >&2
    return 1
  }
}

assert_manager_subgroup() {
  local native_manager_pid native_cgroup_root
  native_cgroup_root=/sys/fs/cgroup/system.slice/dify-native.service
  [[ $(systemctl show "$unit" --property=DelegateSubgroup --value) == manager ]]
  native_manager_pid=$(systemctl show "$unit" --property=MainPID --value)
  [[ $native_manager_pid =~ ^[0-9]+$ && $native_manager_pid -gt 1 ]]
  [[ -z $(sudo cat "$native_cgroup_root/cgroup.procs") ]]
  sudo grep -Fxq "$native_manager_pid" "$native_cgroup_root/manager/cgroup.procs"
}

case ${1:-} in
  provision)
    binary_dir=${2:?binary directory required}
    profile_dir=${3:?profile directory required}
    [[ $(cat /proc/1/comm) == systemd ]]
    require_manager_subgroup_support
    [[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs ]]
    [[ $(cat /sys/module/apparmor/parameters/enabled) == Y ]]
    for path in /var/lib/dify-native /home/dify /workspace "$marker"; do
      [[ ! -e $path ]] || { echo "Fixture path already exists: $path" >&2; exit 1; }
    done
    if id dify-native >/dev/null 2>&1; then
      echo 'Fixture account already exists.' >&2
      exit 1
    fi
    for binary in shellctl shellctl-runner shellctl-runner-exit shellctl-sanitize-pty; do
      [[ -x "$binary_dir/$binary" ]]
    done
    for profile in native-test-supervisor.service native-test-start.sh native-test-apparmor.profile; do
      [[ -s "$profile_dir/$profile" ]]
    done
    printf '%s\n' "$owner" | sudo tee "$marker" >/dev/null
    sudo apt-get update
    sudo apt-get install -y --no-install-recommends apparmor apparmor-utils tmux iproute2
    sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin dify-native
    sudo install -d -m 0700 -o dify-native -g dify-native /var/lib/dify-native
    sudo install -d -m 0555 /var/lib/dify-native/snapshots/fixture-home /var/lib/dify-native/inputs
    sudo install -d -m 0755 /home/dify /workspace /etc/dify-native /usr/local/libexec
    printf 'synthetic native input\n' | sudo tee /var/lib/dify-native/inputs/fixture-input >/dev/null
    sudo chmod 0444 /var/lib/dify-native/inputs/fixture-input
    printf 'foreign scope canary\n' | sudo tee /var/lib/dify-native/foreign-canary >/dev/null
    sudo chmod 0400 /var/lib/dify-native/foreign-canary
    for binary in shellctl shellctl-runner shellctl-runner-exit shellctl-sanitize-pty; do
      sudo install -m 0755 "$binary_dir/$binary" "/usr/local/bin/$binary"
    done
    sudo install -m 0755 "$profile_dir/native-test-start.sh" /usr/local/libexec/dify-native-start
    sudo install -m 0644 "$profile_dir/native-test-supervisor.service" "/etc/systemd/system/$unit"
    sudo install -m 0644 "$profile_dir/native-test-apparmor.profile" /etc/apparmor.d/dify-native-test-supervisor
    # This fixture targets Ubuntu 24.04. Grant userns to this profile only.
    . /etc/os-release
    [[ $ID == ubuntu && $VERSION_ID == 24.04 ]]
    printf 'userns,\n' | sudo tee /etc/apparmor.d/dify-native-userns >/dev/null
    sudo chmod 0644 /etc/apparmor.d/dify-native-userns
    sudo apparmor_parser --replace /etc/apparmor.d/dify-native-test-supervisor
    sudo systemd-analyze verify "/etc/systemd/system/$unit"
    token=$(openssl rand -hex 32)
    printf '::add-mask::%s\n' "$token"
    private_env=$(mktemp "$RUNNER_TEMP/native-supervisor-env.XXXXXX")
    trap 'rm -f "$private_env"' EXIT
    printf 'SHELLCTL_AUTH_TOKEN=%s\nSHELLCTL_NATIVE_MEDIATORS=127.0.0.1:18081\n' "$token" > "$private_env"
    sudo install -m 0600 "$private_env" /etc/dify-native/supervisor.env
    printf 'SHELLCTL_NATIVE_TEST_TOKEN=%s\nSHELLCTL_NATIVE_TEST_URL=http://127.0.0.1:5005\nSHELLCTL_NATIVE_CANARY_URL=http://127.0.0.1:18081\nSHELLCTL_NATIVE_RESTART_STATE=%s/native-scope-restart.json\n' "$token" "$RUNNER_TEMP" >> "$GITHUB_ENV"
    sudo systemd-run --unit=dify-native-canary --property="User=$(id -un)" \
      --property=NoNewPrivileges=yes --property=MemoryMax=64M --property=TasksMax=16 \
      --property=CPUQuota=25% --property=RestrictAddressFamilies=AF_INET \
      /usr/bin/python3 "$GITHUB_WORKSPACE/.github/scripts/builder-native-runtime-canary.py"
    sudo systemctl daemon-reload
    sudo systemctl start "$unit"
    for attempt in $(seq 1 30); do
      if printf 'header = "Authorization: Bearer %s"\n' "$token" | curl --fail --silent --config - http://127.0.0.1:5005/healthz >/dev/null; then
        assert_manager_subgroup
        exit 0
      fi
      sleep 1
    done
    echo 'Native supervisor did not become ready.' >&2
    exit 1
    ;;
  restart)
    owned_fixture
    require_manager_subgroup_support
    sudo systemctl restart "$unit"
    for attempt in $(seq 1 30); do
      if printf 'header = "Authorization: Bearer %s"\n' "${SHELLCTL_NATIVE_TEST_TOKEN:?native supervisor token required}" | curl --fail --silent --config - http://127.0.0.1:5005/healthz >/dev/null; then
        assert_manager_subgroup
        exit 0
      fi
      sleep 1
    done
    echo 'Native supervisor did not recover after restart.' >&2
    exit 1
    ;;
  logs)
    owned_fixture || exit 0
    uname -a
    systemctl --version
    systemctl show --property=Version
    sudo systemctl show "$unit" --property=User,Group,Delegate,DelegateSubgroup,CPUQuotaPerSecUSec,MemoryMax,TasksMax,NoNewPrivileges,AppArmorProfile,ControlGroup,SystemCallFilter,SystemCallErrorNumber
    # Inspect inherited image submounts without dumping mount sources/options,
    # process arguments, environment, or service credentials.
    native_manager_pid=$(systemctl show "$unit" --property=MainPID --value) || native_manager_pid=
    if [[ $native_manager_pid =~ ^[0-9]+$ && $native_manager_pid -gt 1 ]]; then
      printf 'Native manager image mount points and VFS flags\n'
      sudo awk '$5 ~ /^\/(usr|bin|sbin|lib|lib64|etc\/ssl)(\/|$)/ && count++ < 128 {
        print $5, $6
      }' "/proc/$native_manager_pid/mountinfo" || true
    fi
    for group in /sys/fs/cgroup/system.slice/dify-native.service{,/manager,/scopes}; do
      for file in cgroup.type cgroup.procs cgroup.subtree_control cgroup.events; do
        printf '%s\n' "$group/$file"
        sudo cat "$group/$file" || true
      done
    done
    sudo journalctl --no-pager -u "$unit" -n 300
    # A denied startup can have no matching kernel records. Keep the remaining
    # diagnostic output; this best-effort dump never decides qualification.
    sudo journalctl --dmesg --no-pager --grep=dify-native -n 100 || true
    sudo aa-status --json
    ;;
  cleanup)
    owned_fixture || exit 0
    # KillMode=process deliberately retains workers across manager restarts.
    # CI teardown instead kills the complete dedicated unit, never host siblings.
    sudo systemctl kill --kill-whom=all --signal=KILL "$unit" || true
    sudo systemctl stop "$unit" || true
    sudo systemctl reset-failed "$unit" || true
    sudo systemctl stop dify-native-canary.service || true
    sudo rm -f /etc/dify-native/supervisor.env "$marker"
    ;;
  *)
    echo 'Usage: builder-native-runtime-ci.sh provision BIN_DIR PROFILE_DIR | restart | logs | cleanup' >&2
    exit 2
    ;;
esac
