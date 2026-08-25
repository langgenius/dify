import type { AppDescribeInfo } from '@dify/contracts/api/openapi/types.gen'
import type { AppMeta } from '@/types/app-meta'

export const APP_DESCRIBE_MODE_KEY = 'app-describe'

export type AppDescribePayload = {
  info: AppDescribeInfo | null
  parameters: unknown
  input_schema: unknown
}

export class AppDescribeOutput {
  readonly payload: AppDescribePayload

  constructor(meta: AppMeta) {
    this.payload = {
      info: meta.info,
      parameters: meta.parameters,
      input_schema: meta.inputSchema,
    }
  }

  text(): string {
    const lines: string[] = []
    if (this.payload.info !== null && this.payload.info !== undefined) {
      const info = this.payload.info
      const rows: [string, string][] = [
        ['Name', info.name],
        ['ID', info.id],
        ['Mode', info.mode],
        ['Updated', info.updated_at ?? ''],
        ['Service API', info.service_api_enabled ? 'true' : 'false'],
      ]
      if (info.description !== '' && info.description !== undefined)
        rows.push(['Description', info.description ?? ''])
      if (info.is_agent) rows.push(['Agent', 'true'])
      lines.push(...alignedRows(rows))
    }
    if (this.payload.parameters !== null && this.payload.parameters !== undefined) {
      lines.push('Parameters:')
      const indented = JSON.stringify(this.payload.parameters, null, 2)
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
      lines.push(indented)
    }
    return `${lines.join('\n')}\n`
  }

  json(): AppDescribePayload {
    return this.payload
  }
}

function alignedRows(rows: readonly [string, string][]): string[] {
  const widest = rows.reduce((m, [k]) => Math.max(m, k.length), 0)
  return rows.map(([k, v]) => `${`${k}:`.padEnd(widest + 2)}${v}`)
}
