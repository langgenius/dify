#!/bin/sh
set -eu
# This script is executed as the dedicated unprivileged service UID. systemd is
# the administrator that delegates ONLY this fixed unit's subtree beforehand.
# DelegateSubgroup places ExecStart in the leaf before execution, including when
# retained workers keep the unit root's domain controllers enabled on restart.
version_output=$(/usr/bin/systemctl --version) || version_output=
case "$version_output" in
 systemd\ *) systemd_version=${version_output#systemd }; systemd_version=${systemd_version%% *} ;;
 *) systemd_version= ;;
esac
case "$systemd_version" in
 ''|*[!0-9]*) echo 'native supervisor requires systemd >= 254' >&2; exit 1 ;;
esac
if [ "$systemd_version" -lt 254 ]; then
 echo 'native supervisor requires systemd >= 254' >&2
 exit 1
fi
# The installed systemctl version alone does not establish PID 1's behavior.
# Check the actual process placement before creating or changing any cgroup.
manager_placed=false
while IFS=: read -r hierarchy controllers cgroup; do
 if [ "$hierarchy" = 0 ] && [ -z "$controllers" ] &&
    [ "$cgroup" = /system.slice/dify-native.service/manager ]; then
  manager_placed=true
 fi
done < /proc/self/cgroup
if [ "$manager_placed" != true ]; then
 echo 'native supervisor requires DelegateSubgroup=manager placement' >&2
 exit 1
fi
root=/sys/fs/cgroup/system.slice/dify-native.service
[ "$(stat -fc %T "$root")" = cgroup2fs ]
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
