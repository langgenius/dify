import type { TextHandler } from '../../../printers/format-text.js'
import type { AppMeta } from '../../../types/app-meta.js'
import type { AppDescribeInfoType, TagItemType } from '../../../types/openapi-schemas.js'

export const APP_DESCRIBE_MODE_KEY = 'app-describe'

export type AppDescribePayload = {
  info: AppDescribeInfoType | null
  parameters: unknown
  input_schema: unknown
}

export type AppDescribeObject = {
  mode: () => string
  raw: () => AppDescribePayload
}

export function newAppDescribeObject(meta: AppMeta): AppDescribeObject {
  const payload: AppDescribePayload = {
    info: meta.info,
    parameters: meta.parameters,
    input_schema: meta.inputSchema,
  }
  return {
    mode: () => APP_DESCRIBE_MODE_KEY,
    raw: () => payload,
  }
}

export const appDescribeTextHandler: TextHandler = {
  render(raw): string {
    const payload = raw as AppDescribePayload
    const lines: string[] = []
    if (payload.info !== null && payload.info !== undefined) {
      const info = payload.info
      const rows: [string, string][] = [
        ['Name', info.name],
        ['ID', info.id],
        ['Mode', info.mode],
        ['Author', info.author ?? ''],
        ['Updated', info.updated_at ?? ''],
        ['Service API', info.service_api_enabled ? 'true' : 'false'],
        ['Tags', joinTags(info.tags)],
      ]
      if (info.description !== '' && info.description !== undefined)
        rows.push(['Description', info.description ?? ''])
      if (info.is_agent)
        rows.push(['Agent', 'true'])
      lines.push(...alignedRows(rows))
    }
    if (payload.parameters !== null && payload.parameters !== undefined) {
      lines.push('Parameters:')
      const indented = JSON.stringify(payload.parameters, null, 2)
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n')
      lines.push(indented)
    }
    return `${lines.join('\n')}\n`
  },
}

function joinTags(tags: readonly TagItemType[]): string {
  if (tags.length === 0)
    return '<none>'
  return tags.map(t => t.name).join(',')
}

function alignedRows(rows: readonly [string, string][]): string[] {
  const widest = rows.reduce((m, [k]) => Math.max(m, k.length), 0)
  return rows.map(([k, v]) => `${`${k}:`.padEnd(widest + 2)}${v}`)
}
