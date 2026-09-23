#!/usr/bin/env bash

set -euo pipefail

readonly DEFAULT_TEMPLATE_NAME='dify-agent-local-sandbox'
readonly DEFAULT_IMAGE_REPOSITORY='langgenius/dify-agent-local-sandbox'
readonly DEFAULT_PLATFORM='linux/amd64'
readonly DEFAULT_E2B_CLI_VERSION='2.13.3'
readonly DEFAULT_WAIT_SECONDS='600'
readonly DEFAULT_POLL_SECONDS='10'
readonly DEFAULT_CPU_COUNT='2'
readonly DEFAULT_MEMORY_MB='1024'
readonly START_COMMAND='/usr/bin/env SHELLCTL_ENABLE_PATH_ISOLATION=false /usr/local/bin/shellctl serve --listen 0.0.0.0:5004'
readonly READY_COMMAND='curl -fsS http://localhost:5004/healthz'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<EOF
Usage: $(basename "$0") [options]

Synchronize an E2B Template with the published Dify agent runtime image for a
Git commit. The image is resolved to an immutable platform-specific digest and
its OCI revision label must match the source commit before E2B is updated.

Options:
  --source-ref REF          Git ref whose commit should be synchronized (default: HEAD)
  --image-repository IMAGE Published image repository (default: ${DEFAULT_IMAGE_REPOSITORY})
  --image-tag TAG           Published image tag (default: full source commit SHA)
  --template-name NAME      E2B Template name (default: ${DEFAULT_TEMPLATE_NAME})
  --platform OS/ARCH        Image platform consumed by E2B (default: ${DEFAULT_PLATFORM})
  --wait-seconds SECONDS    Maximum time to wait for the image tag (default: ${DEFAULT_WAIT_SECONDS})
  --poll-seconds SECONDS    Delay between registry checks (default: ${DEFAULT_POLL_SECONDS})
  --cpu-count COUNT         Template vCPU count (default: ${DEFAULT_CPU_COUNT})
  --memory-mb MIB           Template memory in MiB (default: ${DEFAULT_MEMORY_MB})
  --no-cache                Disable E2B build cache
  --dry-run                 Validate and print the build without changing E2B
  -h, --help                Show this help

Environment:
  E2B_API_KEY               Required unless --dry-run is used
  E2B_CLI_VERSION           E2B CLI version (default: ${DEFAULT_E2B_CLI_VERSION})
  E2B_TEMPLATE_NAME         Default value for --template-name
  E2B_BASE_IMAGE_REPOSITORY Default value for --image-repository
EOF
}

die() {
  echo "Error: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_non_negative_integer() {
  local name="$1"
  local value="$2"

  [[ "${value}" =~ ^[0-9]+$ ]] || die "${name} must be a non-negative integer: ${value}"
}

require_positive_integer() {
  local name="$1"
  local value="$2"

  require_non_negative_integer "${name}" "${value}"
  (( value > 0 )) || die "${name} must be greater than zero"
}

print_command() {
  printf 'Command:'
  printf ' %q' "$@"
  printf '\n'
}

source_ref='HEAD'
image_repository="${E2B_BASE_IMAGE_REPOSITORY:-${DEFAULT_IMAGE_REPOSITORY}}"
image_tag=''
template_name="${E2B_TEMPLATE_NAME:-${DEFAULT_TEMPLATE_NAME}}"
platform="${DEFAULT_PLATFORM}"
e2b_cli_version="${E2B_CLI_VERSION:-${DEFAULT_E2B_CLI_VERSION}}"
wait_seconds="${DEFAULT_WAIT_SECONDS}"
poll_seconds="${DEFAULT_POLL_SECONDS}"
cpu_count="${DEFAULT_CPU_COUNT}"
memory_mb="${DEFAULT_MEMORY_MB}"
dry_run=false
no_cache=false

while (( $# > 0 )); do
  case "$1" in
    --source-ref)
      (( $# >= 2 )) || die '--source-ref requires a value'
      source_ref="$2"
      shift 2
      ;;
    --image-repository)
      (( $# >= 2 )) || die '--image-repository requires a value'
      image_repository="$2"
      shift 2
      ;;
    --image-tag)
      (( $# >= 2 )) || die '--image-tag requires a value'
      image_tag="$2"
      shift 2
      ;;
    --template-name)
      (( $# >= 2 )) || die '--template-name requires a value'
      template_name="$2"
      shift 2
      ;;
    --platform)
      (( $# >= 2 )) || die '--platform requires a value'
      platform="$2"
      shift 2
      ;;
    --wait-seconds)
      (( $# >= 2 )) || die '--wait-seconds requires a value'
      wait_seconds="$2"
      shift 2
      ;;
    --poll-seconds)
      (( $# >= 2 )) || die '--poll-seconds requires a value'
      poll_seconds="$2"
      shift 2
      ;;
    --cpu-count)
      (( $# >= 2 )) || die '--cpu-count requires a value'
      cpu_count="$2"
      shift 2
      ;;
    --memory-mb)
      (( $# >= 2 )) || die '--memory-mb requires a value'
      memory_mb="$2"
      shift 2
      ;;
    --no-cache)
      no_cache=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ -n "${image_repository}" ]] || die 'image repository cannot be empty'
[[ -n "${template_name}" ]] || die 'template name cannot be empty'
[[ "${platform}" == */* ]] || die "platform must use OS/ARCH form: ${platform}"
require_non_negative_integer 'wait-seconds' "${wait_seconds}"
require_positive_integer 'poll-seconds' "${poll_seconds}"
require_positive_integer 'cpu-count' "${cpu_count}"
require_positive_integer 'memory-mb' "${memory_mb}"

require_command git
require_command docker
require_command jq
require_command mktemp

source_sha="$(git -C "${SCRIPT_DIR}" rev-parse --verify "${source_ref}^{commit}" 2>/dev/null)" \
  || die "cannot resolve source ref: ${source_ref}"
[[ -n "${image_tag}" ]] || image_tag="${source_sha}"

image_ref="${image_repository}:${image_tag}"
platform_os="${platform%%/*}"
platform_arch="${platform#*/}"
deadline=$((SECONDS + wait_seconds))
manifest_json=''
inspect_error=''

while true; do
  if manifest_json="$(docker buildx imagetools inspect --format '{{json .Manifest}}' "${image_ref}" 2>&1)"; then
    break
  fi
  inspect_error="${manifest_json}"
  manifest_json=''

  (( SECONDS < deadline )) || die "image is not available: ${image_ref}${inspect_error:+ (${inspect_error})}"
  echo "Waiting for published image ${image_ref}..." >&2
  sleep "${poll_seconds}"
done

platform_digest="$(
  jq -r \
    --arg os "${platform_os}" \
    --arg arch "${platform_arch}" \
    '[.manifests[]? | select(.platform.os == $os and .platform.architecture == $arch) | .digest][0] // empty' \
    <<<"${manifest_json}"
)"
[[ "${platform_digest}" == sha256:* ]] \
  || die "image ${image_ref} does not contain platform ${platform}"

resolved_image="${image_repository}@${platform_digest}"
image_json="$(docker buildx imagetools inspect --format '{{json .Image}}' "${resolved_image}")" \
  || die "cannot inspect resolved image: ${resolved_image}"

actual_os="$(jq -r '.os // empty' <<<"${image_json}")"
actual_arch="$(jq -r '.architecture // empty' <<<"${image_json}")"
actual_revision="$(jq -r '.config.Labels["org.opencontainers.image.revision"] // empty' <<<"${image_json}")"

[[ "${actual_os}/${actual_arch}" == "${platform}" ]] \
  || die "resolved image platform ${actual_os}/${actual_arch} does not match ${platform}"
[[ "${actual_revision}" == "${source_sha}" ]] \
  || die "image revision ${actual_revision:-<missing>} does not match source commit ${source_sha}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

dockerfile="${tmp_dir}/e2b.Dockerfile"
printf 'FROM %s\nUSER dify\nWORKDIR /home/dify\n' "${resolved_image}" > "${dockerfile}"

e2b_command=(
  npx --yes "@e2b/cli@${e2b_cli_version}"
  template create "${template_name}"
  --path "${tmp_dir}"
  --dockerfile e2b.Dockerfile
  --cmd "${START_COMMAND}"
  --ready-cmd "${READY_COMMAND}"
  --cpu-count "${cpu_count}"
  --memory-mb "${memory_mb}"
)
if [[ "${no_cache}" == true ]]; then
  e2b_command+=(--no-cache)
fi

echo "Source commit: ${source_sha}"
echo "Published image: ${image_ref}"
echo "Resolved image: ${resolved_image} (${platform})"
echo "E2B Template: ${template_name}"
print_command "${e2b_command[@]}"

if [[ "${dry_run}" == true ]]; then
  echo 'Dry run; E2B Template was not changed.'
  exit 0
fi

require_command npx
[[ -n "${E2B_API_KEY:-}" ]] || die 'E2B_API_KEY is required'

"${e2b_command[@]}"
echo "E2B Template synchronized: ${template_name} <- ${resolved_image}"
