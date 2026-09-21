import type { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import picomatch from 'picomatch'
import { compressRaster, compressSvg } from './image-optimizer.ts'

type IgnoreRule = { pattern: string; reason: string }
type Status = 'passed' | 'skipped' | 'error' | 'ignored' | 'fixed'
type Inspection = { status: Status; message: string; candidate?: Buffer }
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const imageExtensions = new Set([
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.avif',
  '.ico',
  '.bmp',
  '.tif',
  '.tiff',
])

export function git(args: string[], root = ROOT) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

export function imagePaths(base: string | undefined, root = ROOT) {
  const output = base
    ? git(
        [
          'diff',
          '--name-only',
          '--diff-filter=ACMRT',
          '-z',
          git(['merge-base', base, 'HEAD'], root).trim(),
          'HEAD',
          '--',
        ],
        root,
      )
    : git(['ls-files', '-z'], root)
  return output
    .split('\0')
    .filter((name) => imageExtensions.has(path.extname(name).toLowerCase()))
    .sort()
}

export async function loadIgnoreRules(root = ROOT): Promise<IgnoreRule[]> {
  const rules: unknown = JSON.parse(
    await fs.readFile(path.join(root, 'packages/image-resources/ignore.json'), 'utf8'),
  )
  if (!Array.isArray(rules))
    throw new Error('ignore.json must contain an array of pattern/reason objects')
  for (const rule of rules as unknown[]) {
    if (
      !rule ||
      typeof rule !== 'object' ||
      !('pattern' in rule) ||
      !('reason' in rule) ||
      Object.keys(rule).sort().join(',') !== 'pattern,reason'
    )
      throw new Error('Each ignore rule must contain only pattern and reason')
    if (
      typeof rule.pattern !== 'string' ||
      !rule.pattern.trim() ||
      typeof rule.reason !== 'string' ||
      !rule.reason.trim()
    )
      throw new Error('Ignore pattern and reason must be nonempty strings')
    if (
      rule.pattern.startsWith('/') ||
      rule.pattern.includes('\\') ||
      rule.pattern.split('/').some((part) => ['.', '..'].includes(part))
    )
      throw new Error('Ignore patterns must be repository-relative paths using forward slashes')
  }
  return rules as IgnoreRule[]
}

export function ignoredReason(name: string, rules: IgnoreRule[]) {
  const rule = rules.find((rule) =>
    picomatch
      .makeRe(rule.pattern.replace(/[()+|^$"]/g, '\\$&'), {
        bash: true,
        dot: true,
        posix: true,
        nonegate: true,
        nobrace: true,
        noext: true,
        noglobstar: true,
        literalBrackets: false,
        keepQuotes: true,
      })
      .test(name),
  )
  return rule ? `${rule.reason} (pattern: ${rule.pattern})` : undefined
}

export function exceedsThreshold(before: number, after: number) {
  return (before - after) * 100 > before * 25
}

export async function inspectImage(name: string, root = ROOT): Promise<Inspection> {
  try {
    const filename = path.join(root, name)
    if ((await fs.lstat(filename)).isSymbolicLink())
      throw new Error('Image symlinks are not supported; use a regular image file.')
    const data = await fs.readFile(filename)
    if (!data.length) throw new Error('Image is empty')
    const trial = await (path.extname(name).toLowerCase() === '.svg'
      ? compressSvg(data)
      : compressRaster(data))
    if (trial.method.startsWith('skipped:')) return { status: 'skipped', message: trial.method }
    const after = Math.min(data.length, trial.data.length)
    const savings = (100 * (data.length - after)) / data.length
    const message = `${data.length.toLocaleString('en-US')} B → ${after.toLocaleString('en-US')} B (${savings.toFixed(1)}% smaller); ${trial.method}`
    if (exceedsThreshold(data.length, after))
      return {
        status: 'error',
        message: `${message}. Review the candidate and optimize this image before merging.`,
        candidate: trial.data,
      }
    return { status: 'passed', message }
  } catch (error) {
    return { status: 'error', message: `Unable to inspect image: ${errorMessage(error)}` }
  }
}

export function escapeAnnotation(value: string) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(',', '%2C')
    .replaceAll(':', '%3A')
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

// Resolve existing ancestors too, so a symlink cannot turn an outside output path into the source tree.
async function resolveDestination(filename: string): Promise<string> {
  try {
    return await fs.realpath(filename)
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    return path.join(await resolveDestination(path.dirname(filename)), path.basename(filename))
  }
}

async function replaceImage(filename: string, candidate: Buffer) {
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const { mode } = await fs.stat(filename)
    await fs.writeFile(temporary, candidate, { flag: 'wx', mode })
    await fs.rename(temporary, filename)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

/* oxlint-disable no-console -- CLI output includes reports and GitHub Actions annotations. */
export async function main(args = process.argv.slice(2), root = ROOT) {
  let options
  let rules: IgnoreRule[]
  let outputDir: string | undefined
  try {
    options = parseArgs({
      args,
      options: {
        base: { type: 'string' },
        all: { type: 'boolean' },
        fix: { type: 'boolean' },
        'output-dir': { type: 'string' },
        help: { type: 'boolean' },
      },
    }).values
    if (options.help) {
      console.log(
        'Usage: node packages/image-resources/check-image-resources.ts (--base REF | --all) [--fix | --output-dir DIR]',
      )
      return 0
    }
    if (Boolean(options.base) === Boolean(options.all))
      throw new Error('Choose exactly one of --base REF or --all')
    if (options.fix && options['output-dir'])
      throw new Error('--fix and --output-dir are mutually exclusive')
    if (options['output-dir']) {
      outputDir = await resolveDestination(path.resolve(options['output-dir']))
      if (inside(await fs.realpath(root), outputDir))
        throw new Error('--output-dir must be outside the repository')
    }
    try {
      rules = await loadIgnoreRules(root)
    } catch (error) {
      throw new Error(`Invalid image ignore configuration: ${errorMessage(error)}`)
    }
  } catch (error) {
    console.error(errorMessage(error))
    return 2
  }
  const results: (Inspection & { name: string })[] = []
  for (const name of imagePaths(options.base, root)) {
    const reason = ignoredReason(name, rules)
    const result: Inspection = reason
      ? { status: 'ignored', message: reason }
      : await inspectImage(name, root)
    if (result.candidate && options.fix) {
      try {
        await replaceImage(path.join(root, name), result.candidate)
        result.status = 'fixed'
        result.message = result.message.replace(
          'Review the candidate and optimize this image before merging.',
          'Applied candidate. Review the image in its rendered context before committing.',
        )
      } catch (error) {
        result.message = `Unable to write optimized image: ${errorMessage(error)}`
      }
    }
    if (result.candidate && outputDir) {
      try {
        const output = await resolveDestination(path.join(outputDir, name))
        if (inside(await fs.realpath(root), output))
          throw new Error('Candidate output must be outside the repository')
        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.writeFile(output, result.candidate)
      } catch (error) {
        result.message += `. Unable to export candidate: ${errorMessage(error)}`
      }
    }
    results.push({ name, ...result })
    console.log(`${result.status}: ${JSON.stringify(name)}: ${JSON.stringify(result.message)}`)
    if (result.status === 'error' && process.env.GITHUB_ACTIONS === 'true')
      console.log(`::error file=${escapeAnnotation(name)}::${escapeAnnotation(result.message)}`)
  }
  const count = (status: Status) => results.filter((result) => result.status === status).length
  const summary = `Checked ${results.length} images: ${count('error')} failures, ${count('skipped')} skipped, ${count('ignored')} ignored, ${count('fixed')} fixed.`
  console.log(summary)
  if (count('fixed'))
    console.log(
      'Review all modified images visually before committing; JPEG/WebP compression is lossy.',
    )
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## Image optimization\n\n${summary}\n\nFails only above 25% potential savings or on inspection errors. No fixed byte limits.\n\nCandidates keep image dimensions. JPEG/WebP trials are lossy and require visual review.\n\n${results.map((result) => `- **${result.status}** <code>${escapeHtml(result.name)}</code>: ${escapeHtml(result.message)}\n`).join('')}`,
    )
  }
  return Number(count('error') > 0)
}

/* oxlint-enable no-console */

if (import.meta.main) {
  try {
    // oxlint-disable-next-line antfu/no-top-level-await -- Wait for CLI completion before setting its exit status.
    process.exitCode = await main()
  } catch (error) {
    console.error(errorMessage(error))
    process.exitCode = 1
  }
}
