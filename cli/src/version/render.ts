import type { VersionReport } from './probe.js'
import pc from 'picocolors'

const RC_WARNING_LINES = [
  'WARNING: This build is a release candidate. It is in beta test, not stable,',
  '         and may have bugs. For production use, install the stable channel.',
] as const

export type RenderOptions = {
  readonly color?: boolean
}

const COMPAT_GLYPH: Record<VersionReport['compat']['status'], string> = {
  compatible: 'ok',
  unsupported: 'incompatible',
  unknown: 'unknown',
}

function shortCommit(commit: string): string {
  return commit.length > 7 ? commit.slice(0, 7) : commit
}

function colorize(useColor: boolean, fn: (s: string) => string): (s: string) => string {
  return useColor ? fn : (s: string) => s
}

export function renderVersionText(report: VersionReport, opts: RenderOptions = {}): string {
  const useColor = opts.color === true
  const yellow = colorize(useColor, pc.yellow)
  const dim = colorize(useColor, pc.dim)

  const lines: string[] = []

  const { client, server, compat } = report
  lines.push('Client:')
  lines.push(`  Version:   ${client.version} (channel: ${client.channel})`)
  lines.push(`  Commit:    ${shortCommit(client.commit)} (built ${client.buildDate})`)
  lines.push(`  Platform:  ${client.platform}/${client.arch}`)
  lines.push(`  Compat:    dify >=${compat.minDify}, <=${compat.maxDify}`)
  lines.push('')

  lines.push('Server:')
  if (server.endpoint === '') {
    lines.push(`  ${dim('(skipped — no host configured or --client passed)')}`)
  }
  else if (!server.reachable) {
    lines.push(`  Endpoint:  ${server.endpoint}`)
    lines.push(`  Version:   ${dim('(unreachable)')}`)
  }
  else {
    lines.push(`  Endpoint:  ${server.endpoint}`)
    lines.push(`  Version:   ${server.version ?? ''}${server.edition !== undefined ? ` (${server.edition.toLowerCase()})` : ''}`)
  }
  lines.push('')

  const verdictText = `Compatibility: ${COMPAT_GLYPH[compat.status]} — ${compat.detail}`
  if (compat.status === 'unsupported')
    lines.push(yellow(verdictText))
  else
    lines.push(verdictText)

  if (client.channel === 'rc') {
    lines.push('')
    for (const line of RC_WARNING_LINES)
      lines.push(yellow(line))
  }

  return `${lines.join('\n')}\n`
}
