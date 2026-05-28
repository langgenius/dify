import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HostsBundle } from '../auth/hosts.js'
import type { CompatVerdict } from './compat.js'
import type { Channel } from './info.js'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '../api/meta.js'
import { loadHosts } from '../auth/hosts.js'
import { createClient } from '../http/client.js'
import { resolveConfigDir } from '../store/dir.js'
import { arch, platform } from '../sys/index.js'
import { hostWithScheme } from '../util/host.js'
import { difyCompat, evaluateCompat } from './compat.js'
import { versionInfo } from './info.js'

export type ClientBlock = {
  readonly version: string
  readonly commit: string
  readonly buildDate: string
  readonly channel: Channel
  readonly platform: string
  readonly arch: string
}

export type ServerBlock = {
  readonly endpoint: string
  readonly reachable: boolean
  readonly version?: string
  readonly edition?: ServerVersionResponse['edition']
}

export type CompatBlock = CompatVerdict & {
  readonly minDify: string
  readonly maxDify: string
}

export type VersionReport = {
  readonly client: ClientBlock
  readonly server: ServerBlock
  readonly compat: CompatBlock
}

// /openapi/v1/_version is intentionally unauthenticated, so the probe does not
// take a bearer. Same signature shape as the auto-nudge probe — easy to swap.
export type MetaProbe = (endpoint: string) => Promise<ServerVersionResponse>

export type RunVersionProbeOptions = {
  readonly skipServer: boolean
  readonly loadBundle?: () => Promise<HostsBundle | undefined>
  readonly probe?: MetaProbe
}

const defaultLoadBundle = async (): Promise<HostsBundle | undefined> => loadHosts(resolveConfigDir())

const defaultProbe: MetaProbe = async (endpoint) => {
  const http = createClient({ host: endpoint, timeoutMs: META_PROBE_TIMEOUT_MS, retryAttempts: 0 })
  return new MetaClient(http).serverVersion()
}

function buildClientBlock(): ClientBlock {
  return {
    version: versionInfo.version,
    commit: versionInfo.commit,
    buildDate: versionInfo.buildDate,
    channel: versionInfo.channel,
    platform: platform(),
    arch: arch(),
  }
}

function unreachableServer(endpoint: string): ServerBlock {
  return { endpoint, reachable: false }
}

function compatBlock(verdict: CompatVerdict): CompatBlock {
  return {
    minDify: difyCompat.minDify,
    maxDify: difyCompat.maxDify,
    status: verdict.status,
    detail: verdict.detail,
  }
}

export async function runVersionProbe(opts: RunVersionProbeOptions): Promise<VersionReport> {
  const client = buildClientBlock()

  if (opts.skipServer) {
    return {
      client,
      server: { endpoint: '', reachable: false },
      compat: compatBlock({ status: 'unknown', detail: 'server probe skipped' }),
    }
  }

  const loadBundle = opts.loadBundle ?? defaultLoadBundle
  const probe = opts.probe ?? defaultProbe

  let bundle: HostsBundle | undefined
  let loadFailed = false
  try {
    bundle = await loadBundle()
  }
  catch {
    loadFailed = true
  }

  if (bundle === undefined || bundle.current_host === '') {
    const detail = loadFailed ? 'hosts file unreadable' : 'no host configured'
    return {
      client,
      server: { endpoint: '', reachable: false },
      compat: compatBlock({ status: 'unknown', detail }),
    }
  }

  const endpoint = hostWithScheme(bundle.current_host, bundle.scheme)

  let serverInfo: ServerVersionResponse | undefined
  try {
    serverInfo = await probe(endpoint)
  }
  catch {
    serverInfo = undefined
  }

  if (serverInfo === undefined)
    return { client, server: unreachableServer(endpoint), compat: compatBlock({ status: 'unknown', detail: 'server unreachable' }) }

  return {
    client,
    server: {
      endpoint,
      reachable: true,
      version: serverInfo.version,
      edition: serverInfo.edition,
    },
    compat: compatBlock(evaluateCompat(serverInfo.version)),
  }
}
