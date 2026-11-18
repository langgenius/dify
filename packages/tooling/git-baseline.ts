import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

function git(cwd: string, args: string[], allowMissing = false): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowMissing)
    throw new Error(result.stderr.trim() || 'Git baseline lookup failed.')
  return result.status === 0 ? result.stdout : ''
}

/** Resolve to a commit so task-cache keys change when the comparison base changes. */
export function resolveEditionGuardBase(cwd: string): string {
  const requested = process.env.DIFY_EDITION_GUARD_BASE_REV
  if (requested) return git(cwd, ['rev-parse', '--verify', `${requested}^{commit}`]).trim()
  const mergeBase = ['upstream/main', 'origin/main', 'main']
    .map((ref) => git(cwd, ['merge-base', 'HEAD', ref], true).trim())
    .find(Boolean)
  return mergeBase || git(cwd, ['rev-parse', '--verify', 'HEAD']).trim()
}

/** Preserve file renames without carrying feature-policy exemptions to consumers. */
export function editionBaseline(cwd: string, filename: string, exemptPaths: ReadonlySet<string>) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).trim()
  const path = relative(root, resolve(cwd, filename)).replaceAll('\\', '/')
  if (exemptPaths.has(path)) return { path, filename: resolve(root, path), source: '' }
  const base = resolveEditionGuardBase(root)
  const renames = git(root, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--diff-filter=R',
    base,
    '--',
    'web',
  ]).split('\0')
  let oldPath = path
  for (let index = 0; index + 2 < renames.length; index += 3) {
    if (renames[index + 2] === path) oldPath = renames[index + 1]!
  }
  const exists =
    !exemptPaths.has(oldPath) &&
    git(root, ['ls-tree', '--name-only', base, '--', oldPath]).length > 0
  return {
    path,
    filename: resolve(root, oldPath),
    source: exists ? git(root, ['show', `${base}:${oldPath}`]) : '',
  }
}
