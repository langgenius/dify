import type { Channel } from './info'
import type { VersionReport } from './probe'
import { colorScheme } from '@/sys/io/color'

function prereleaseWarning(channel: Channel): readonly string[] {
  return [
    `WARNING: This build is a ${channel} release. It is not stable`,
    '         and may have bugs. For production use, install or wait for the stable channel.',
  ]
}

export type RenderOptions = {
  readonly color?: boolean
}

const COMPAT_LABEL: Record<VersionReport['compat']['status'], string> = {
  compatible: 'ok',
  unsupported: 'incompatible',
  unknown: 'unknown',
}

function shortCommit(commit: string): string {
  return commit.length > 7 ? commit.slice(0, 7) : commit
}

export function renderVersionText(report: VersionReport, opts: RenderOptions = {}): string {
  const c = colorScheme(opts.color === true)
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
    lines.push(`  ${c.dim('(skipped — no host configured or --client passed)')}`)
  }
  else if (!server.reachable) {
    lines.push(`  Endpoint:  ${server.endpoint}`)
    lines.push(`  Version:   ${c.dim('(unreachable)')}`)
  }
  else {
    lines.push(`  Endpoint:  ${server.endpoint}`)
    lines.push(`  Version:   ${server.version ?? ''}${server.edition !== undefined ? ` (${server.edition.toLowerCase()})` : ''}`)
  }
  lines.push('')

  const verdictText = `Compatibility: ${COMPAT_LABEL[compat.status]} — ${compat.detail}`
  lines.push(compat.status === 'unsupported' ? c.yellow(verdictText) : verdictText)

  if (client.channel !== 'stable') {
    lines.push('')
    for (const line of prereleaseWarning(client.channel))
      lines.push(c.yellow(line))
  }

  return `${lines.join('\n')}\n`
}
