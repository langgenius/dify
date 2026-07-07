import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./release-r2-publish.sh', import.meta.url))

// Stub `aws` + `curl` + `node` as shell functions that just log action verbs to
// $ORDER_LOG, then run the publish `main` and assert the order of operations.
function runPublish(): { code: number, order: string[], stderr: string } {
  const stub = [
    'ORDER_LOG="$(mktemp)"',
    'aws() {',
    '  case "$*" in',
    '    *"list-objects-v2"*)       echo list-survivors >>"$ORDER_LOG" ;;',
    '    *" cp "*"/index.json"*)    echo put-index      >>"$ORDER_LOG" ;;',
    '    *" cp "*"/manifest.json"*) echo put-manifest   >>"$ORDER_LOG" ;;',
    '    *" sync "*)                echo sync-binaries   >>"$ORDER_LOG" ;;',
    '    *"head-object"*)           echo head-verify    >>"$ORDER_LOG" ;;',
    '    *) : ;;',
    '  esac',
    '}',
    'curl() { echo "{}"; }',
    'node() {',
    '  case "$*" in',
    '    *release-naming.mjs*targets*)',
    '      printf \'bun-linux-x64\\tlinux-x64\\t0\\nbun-linux-arm64\\tlinux-arm64\\t0\\nbun-darwin-x64\\tdarwin-x64\\t0\\nbun-darwin-arm64\\tdarwin-arm64\\t0\\nbun-windows-x64\\twindows-x64\\t1\\n\' ;;',
    '    *release-naming.mjs*\' asset \'*)  printf \'difyctl-vX\\n\' ;;',
    '    *release-r2-edge.mjs*\' index \'*)    echo \'{}\' ;;',
    '    *release-r2-edge.mjs*\' manifest \'*) echo \'{}\' ;;',
    '    *) : ;;',
    '  esac',
    '}',
  ].join('\n')
  const program = [
    stub,
    `. "${SCRIPT}"`,
    'publish_main edge 0.1.0-edge.2fd7b82',
    'cat "$ORDER_LOG"',
  ].join('\n')
  // bash, NOT sh: the script uses BASH_SOURCE + process substitution.
  const r = spawnSync('bash', ['-c', program], {
    encoding: 'utf8',
    env: {
      ...process.env,
      RELEASE_PUBLISH_LIB: '1',
      DIFYCTL_R2_S3_ENDPOINT: 'https://endpoint.example',
      DIFYCTL_R2_BUCKET: 'cli-dev',
      DIFYCTL_R2_PUBLIC_BASE: 'https://pub.example.r2.dev',
      DIST_DIR: '/tmp',
    },
  })
  return { code: r.status ?? 1, order: (r.stdout ?? '').trim().split('\n').filter(Boolean), stderr: r.stderr ?? '' }
}

describe('release-r2-publish order', () => {
  it('uploads binaries, verifies, lists survivors, then index, then manifest', () => {
    const { code, order } = runPublish()
    expect(code).toBe(0)
    expect(order.indexOf('sync-binaries')).toBeLessThan(order.indexOf('head-verify'))
    expect(order.indexOf('head-verify')).toBeLessThan(order.indexOf('list-survivors'))
    expect(order.indexOf('list-survivors')).toBeLessThan(order.indexOf('put-index'))
    expect(order.indexOf('put-index')).toBeLessThan(order.indexOf('put-manifest'))
    // pointer is never pruned here — deletion is owned by the R2 lifecycle rule
    expect(order).not.toContain('prune')
  })

  it('exits non-zero when no targets resolve (head-verify safety gate)', () => {
    const stub = [
      'aws() { :; }',
      'curl() { echo "{}"; }',
      'node() { case "$*" in *release-naming.mjs*targets*) : ;; *) echo "{}" ;; esac; }',
    ].join('\n')
    const program = [stub, `. "${SCRIPT}"`, 'publish_main edge 0.1.0-edge.2fd7b82'].join('\n')
    const r = spawnSync('bash', ['-c', program], {
      encoding: 'utf8',
      env: {
        ...process.env,
        RELEASE_PUBLISH_LIB: '1',
        DIFYCTL_R2_S3_ENDPOINT: 'https://endpoint.example',
        DIFYCTL_R2_BUCKET: 'cli-dev',
        DIFYCTL_R2_PUBLIC_BASE: 'https://pub.example.r2.dev',
        DIST_DIR: '/tmp',
      },
    })
    expect(r.status).not.toBe(0)
  })
})
