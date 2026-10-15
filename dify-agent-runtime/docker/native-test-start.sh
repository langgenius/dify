#!/bin/sh
set -eu
# This script is executed as the dedicated unprivileged service UID. systemd is
# the administrator that delegates ONLY this fixed unit's subtree beforehand.
root=/sys/fs/cgroup/system.slice/dify-native.service
[ "$(stat -fc %T "$root")" = cgroup2fs ]
mkdir -p "$root/manager"
printf '%s\n' "$$" > "$root/manager/cgroup.procs"
printf '+cpu +memory +pids\n' > "$root/cgroup.subtree_control"
mkdir -p "$root/scopes"
printf '200000 100000\n' > "$root/scopes/cpu.max"
printf '2147483648\n' > "$root/scopes/memory.max"
printf '0\n' > "$root/scopes/memory.swap.max"
printf '512\n' > "$root/scopes/pids.max"
printf '+cpu +memory +pids\n' > "$root/scopes/cgroup.subtree_control"
exec /usr/local/bin/shellctl serve --native-test-supervisor \
 --listen 127.0.0.1:5005 --state-dir /var/lib/dify-native \
 --native-cgroup-root "$root/scopes" \
 --native-snapshot-root /var/lib/dify-native/snapshots \
 --native-input-root /var/lib/dify-native/inputs \
 --native-mediators "${SHELLCTL_NATIVE_MEDIATORS:-}"
