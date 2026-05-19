import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { HostsBundle } from '../auth/hosts.js'
import type { CompatVerdict } from './compat.js'
import type { Channel } from './info.js'
import { MetaClient } from '../api/meta.js'
import { loadHosts } from '../auth/hosts.js'
import { resolveConfigDir } from '../config/dir.js'
import { createClient } from '../http/client.js'
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

export type MetaProbe = (endpoint: string, bearer: string | undefined) => Promise<ServerVersionResponse>

export type RunVersionProbeOptions = {
  readonly skipServer: boolean
  readonly loadBundle?: () => Promise<HostsBundle | undefined>
  readonly probe?: MetaProbe
}

const defaultLoadBundle = async (): Promise<HostsBundle | undefined> => loadHosts(resolveConfigDir())

const defaultProbe: MetaProbe = async (endpoint, bearer) => {
  const http = createClient({ host: endpoint, bearer })
  return new MetaClient(http).serverVersion()
}

function buildClientBlock(): ClientBlock {
  return {
    version: versionInfo.version,
    commit: versionInfo.commit,
    buildDate: versionInfo.buildDate,
    channel: versionInfo.channel,
    platform: process.platform,
    arch: process.arch,
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
  try {
    bundle = await loadBundle()
  }
  catch {
    bundle = undefined
  }

  if (bundle === undefined || bundle.current_host === '') {
    return {
      client,
      server: { endpoint: '', reachable: false },
      compat: compatBlock({ status: 'unknown', detail: 'no host configured' }),
    }
  }

  const endpoint = hostWithScheme(bundle.current_host, bundle.scheme)
  const bearer = bundle.tokens?.bearer

  let serverInfo: ServerVersionResponse | undefined
  try {
    serverInfo = await probe(endpoint, bearer)
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
