import { ENV_REGISTRY } from '../../../env/registry.js'

export type EnvLookup = (name: string) => string | undefined

export type RunEnvListOptions = {
  readonly json?: boolean
  readonly lookup?: EnvLookup
}

export type EnvListJsonRow = {
  name: string
  description: string
  sensitive: boolean
  value: string
}

const COLUMN_PADDING = 2

export function runEnvList(opts: RunEnvListOptions = {}): string {
  const lookup = opts.lookup ?? defaultLookup
  if (opts.json) {
    const rows: EnvListJsonRow[] = ENV_REGISTRY.map(v => ({
      name: v.name,
      description: v.description,
      sensitive: v.sensitive ?? false,
      value: displayValue(v.name, v.sensitive ?? false, lookup),
    }))
    return `${JSON.stringify(rows, null, 2)}\n`
  }
  const header: readonly string[] = ['NAME', 'VALUE', 'DESCRIPTION']
  const dataRows = ENV_REGISTRY.map(v => [
    v.name,
    displayValue(v.name, v.sensitive ?? false, lookup),
    v.description,
  ])
  return renderTable([header, ...dataRows])
}

function displayValue(name: string, sensitive: boolean, lookup: EnvLookup): string {
  const raw = lookup(name) ?? ''
  if (sensitive)
    return raw === '' ? '<unset>' : '<set>'
  return raw === '' ? '<unset>' : raw
}

function renderTable(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0)
    return ''
  const cols = rows[0]?.length ?? 0
  const widths: number[] = Array.from({ length: cols }, () => 0)
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      const cell = row[i] ?? ''
      if (cell.length > (widths[i] ?? 0))
        widths[i] = cell.length
    }
  }
  let out = ''
  for (const row of rows) {
    const parts: string[] = []
    for (let i = 0; i < cols; i++) {
      const cell = row[i] ?? ''
      const pad = i === cols - 1 ? '' : ' '.repeat((widths[i] ?? 0) - cell.length + COLUMN_PADDING)
      parts.push(`${cell}${pad}`)
    }
    out += `${parts.join('').trimEnd()}\n`
  }
  return out
}

function defaultLookup(name: string): string | undefined {
  return process.env[name]
}
