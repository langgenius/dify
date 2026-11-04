import { access, readdir, readFile, writeFile } from 'node:fs/promises'

type NodeDefaults = Record<string, Record<string, unknown>>

const nodesDirectory = new URL('../app/components/workflow/nodes/', import.meta.url)
const output = new URL(
  '../../api/services/workflow/authoring/canvas_defaults.json',
  import.meta.url,
)

const DROPPED_KEYS = new Set(['type', 'title', 'desc', 'version'])
const EDITOR_ONLY_PREFIX = '_'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEmpty(value: unknown): boolean {
  if (value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return isRecord(value) && Object.keys(value).length === 0
}

function byKey([a]: readonly [string, unknown], [b]: readonly [string, unknown]) {
  return a < b ? -1 : a > b ? 1 : 0
}

function cleaned(value: unknown): unknown {
  if (Array.isArray(value))
    return value
      .filter((item) => item != null)
      .map(cleaned)
      .filter((item) => !isEmpty(item))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !key.startsWith(EDITOR_ONLY_PREFIX) && item != null)
      .sort(byKey)
      .map(([key, item]) => [key, cleaned(item)] as const)
      .filter(([, item]) => !isEmpty(item)),
  )
}

export function canvasDefault(defaultValue: Record<string, unknown>) {
  const kept = Object.fromEntries(
    Object.entries(defaultValue).filter(([key]) => !DROPPED_KEYS.has(key)),
  )
  return cleaned(kept)
}

export function renderNodeDefaults(defaults: NodeDefaults) {
  const entries = Object.entries(defaults)
    .map(([type, value]) => [type, canvasDefault(value)] as const)
    .sort(byKey)
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`
}

export async function syncNodeDefaults({
  file,
  generated,
  check,
}: {
  file: URL
  generated: string
  check: boolean
}) {
  if (!check) {
    await writeFile(file, generated)
    return
  }
  const current = await readFile(file, 'utf8').catch(() => '')
  if (current !== generated) {
    throw new Error(
      'Node defaults are stale. Run pnpm --dir web gen:node-defaults and commit the result.',
    )
  }
}

async function evaluatedDefaults() {
  const directories = (await readdir(nodesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const defaults: NodeDefaults = {}
  for (const directory of directories) {
    const file = new URL(`${directory}/default.ts`, nodesDirectory)
    if (
      !(await access(file).then(
        () => true,
        () => false,
      ))
    )
      continue
    const module: unknown = await import(file.href)
    const nodeDefault = isRecord(module) ? module.default : undefined
    if (
      !isRecord(nodeDefault) ||
      !isRecord(nodeDefault.metaData) ||
      !isRecord(nodeDefault.defaultValue)
    )
      throw new Error(`${directory}/default.ts has no metaData and defaultValue`)
    const type = nodeDefault.metaData.type
    if (typeof type !== 'string') throw new Error(`${directory}/default.ts declares no node type`)
    if (type in defaults) throw new Error(`${directory}/default.ts repeats node type ${type}`)
    defaults[type] = nodeDefault.defaultValue
  }
  return defaults
}

async function main() {
  const generated = renderNodeDefaults(await evaluatedDefaults())
  await syncNodeDefaults({ file: output, generated, check: process.argv.includes('--check') })
}

if (import.meta.main) await main()
