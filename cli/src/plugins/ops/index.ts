import type { CatalogOp, CatalogService } from '@/plugins/catalog'
import { definePlugin } from '@/kernel/plugin'
import { catalog } from '@/plugins/catalog'
import { http } from '@/plugins/http'
import { session } from '@/plugins/session'
import { PIN } from '@/protocol/pins'
import { isRecord } from '@/util/is-record'
import { BINARY } from '@/version/info'

export type OpListRow = {
  id: string
  summary: string
  kind: string
  tags: readonly string[]
  deprecated: boolean
}

export type OpRow = CatalogOp & {
  id: string
  usage: string
  pins?: Record<string, string | null>
}

export type ListOptions = Readonly<{ includeInternal: boolean }>

export type OpsService = {
  readonly resolve: (id: string) => Promise<CatalogOp>
  readonly list: (opts: ListOptions) => Promise<OpListRow[]>
  readonly describe: (id: string) => Promise<OpRow>
}

const CALL_COMMAND = 'call'
const INPUT_USAGE = '--input <json|@file|@->'

function byId(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function listRows(ops: Readonly<Record<string, CatalogOp>>, opts: ListOptions): OpListRow[] {
  return Object.entries(ops)
    .filter(([, op]) => opts.includeInternal || !op.internal)
    .sort(([a], [b]) => byId(a, b))
    .map(([id, op]) => ({
      id,
      summary: op.summary,
      kind: op.kind,
      tags: op.tags,
      deprecated: op.deprecated,
    }))
}

function takesWorkspacePin(op: CatalogOp): boolean {
  return isRecord(op.input.properties) && PIN.Workspace in op.input.properties
}

export const ops = definePlugin({
  name: 'ops',
  needs: [catalog, http, session],
  build: async (ctx): Promise<OpsService> => {
    const catalogService = await ctx.get(catalog)
    const httpService = await ctx.get(http)

    async function loaded(): Promise<CatalogService> {
      if (!catalogService.loaded) await catalogService.replace(await httpService.fetchCatalog())
      return catalogService
    }

    // An id the cached catalog does not know is refetched once: the server may have
    // added the op since this cache was written.
    const resolve: OpsService['resolve'] = async (id) => {
      const known = (await loaded()).op(id)
      if (known !== undefined) return known
      await catalogService.replace(await httpService.fetchCatalog())
      return catalogService.opOrThrow(id)
    }

    const list: OpsService['list'] = async (opts) => listRows((await loaded()).ops(), opts)

    const describe: OpsService['describe'] = async (id) => {
      const op = await resolve(id)
      // Spread twice on purpose: the first fixes the key order, the second keeps a
      // catalog op that carries `id` or `usage` of its own from overwriting the CLI's.
      const own = { id, usage: [BINARY, CALL_COMMAND, id, INPUT_USAGE].join(' ') }
      const row: OpRow = { ...own, ...op, ...own }
      if (!takesWorkspacePin(op)) return row
      const workspaceId = await (await ctx.get(session)).workspaceId()
      return { ...row, pins: { [PIN.Workspace]: workspaceId } }
    }

    return { resolve, list, describe }
  },
})
