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

case ${1:-} in
  provision)
    binary_dir=${2:?binary directory required}
    profile_dir=${3:?profile directory required}
    [[ $(cat /proc/1/comm) == systemd ]]
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
    sudo apparmor_parser --replace --warn /etc/apparmor.d/dify-native-test-supervisor
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
      if curl --fail --silent http://127.0.0.1:5005/healthz >/dev/null; then
        exit 0
      fi
      sleep 1
    done
    echo 'Native supervisor did not become ready.' >&2
    exit 1
    ;;
  restart)
    owned_fixture
    sudo systemctl restart "$unit"
    for attempt in $(seq 1 30); do
      if curl --fail --silent http://127.0.0.1:5005/healthz >/dev/null; then
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
    sudo systemctl show "$unit" --property=User,Group,Delegate,CPUQuotaPerSecUSec,MemoryMax,TasksMax,NoNewPrivileges,AppArmorProfile,ControlGroup,SystemCallFilter,SystemCallErrorNumber
    sudo journalctl --no-pager -u "$unit" -n 300
    sudo journalctl --dmesg --no-pager --grep=dify-native -n 100
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
