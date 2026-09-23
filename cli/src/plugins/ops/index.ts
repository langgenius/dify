import type { CatalogOp, CatalogService } from '@/plugins/catalog'
import type { CommandConstructor, Descriptor } from '@/plugins/commands/command'
import type { CommandTree } from '@/plugins/commands/registry'
import { definePlugin } from '@/kernel/plugin'
import { catalog } from '@/plugins/catalog'
import { http } from '@/plugins/http'
import { session } from '@/plugins/session'
import { COMMAND_SEPARATOR, spacedId } from '@/protocol/op-id'
import { BINARY } from '@/version/info'
import { opCommand } from './command'
import { opsTree } from './tree'

export type OpListRow = {
  id: string
  summary: string
  kind: string
  deprecated: boolean
}

export type ListOptions = Readonly<{ includeInternal: boolean }>

export type TreeOptions = ListOptions & Readonly<{ fresh: boolean }>

export type OpsService = {
  readonly resolve: (id: string) => Promise<CatalogOp>
  readonly list: (opts: ListOptions) => Promise<OpListRow[]>
  readonly commands: (opts: TreeOptions) => Promise<CommandTree>
  readonly command: (id: string) => Promise<CommandConstructor>
  readonly describe: (id: string) => Promise<Descriptor>
}

const CALL_COMMAND = 'call'
const INPUT_USAGE = '--input <json|@file|@->'
const NO_REST: readonly string[] = []

/** The id form of an op: the whole body in one flag, whatever fields it declares. */
function callUsage(id: string): string {
  return [BINARY, CALL_COMMAND, id, INPUT_USAGE].join(COMMAND_SEPARATOR)
}

function byId(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function shown(
  ops: Readonly<Record<string, CatalogOp>>,
  opts: ListOptions,
): Readonly<Record<string, CatalogOp>> {
  return Object.fromEntries(
    Object.entries(ops).filter(([, op]) => opts.includeInternal || !op.internal),
  )
}

function listRows(ops: Readonly<Record<string, CatalogOp>>): OpListRow[] {
  return Object.entries(ops)
    .sort(([a], [b]) => byId(a, b))
    .map(([id, op]) => ({
      id,
      summary: op.summary,
      kind: op.kind,
      deprecated: op.deprecated,
    }))
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

    async function refresh(): Promise<Readonly<Record<string, CatalogOp>>> {
      await catalogService.replace(await httpService.fetchCatalog())
      return catalogService.ops()
    }

    // An id the cached catalog does not know is refetched once: the server may have
    // added the op since this cache was written.
    const resolve: OpsService['resolve'] = async (id) => {
      const known = (await loaded()).op(id)
      if (known !== undefined) return known
      await refresh()
      return catalogService.opOrThrow(id)
    }

    const list: OpsService['list'] = async (opts) => listRows(shown((await loaded()).ops(), opts))

    const commands: OpsService['commands'] = async (opts) =>
      opsTree(shown(opts.fresh ? await refresh() : (await loaded()).ops(), opts))

    const command: OpsService['command'] = async (id) => opCommand(id, await resolve(id))

    // The op's own descriptor, so its examples read as the spaced commands that run; only
    // the usage line stays the `call` form.
    const describe: OpsService['describe'] = async (id) => {
      const Ctor = await command(id)
      const path = spacedId(id).split(COMMAND_SEPARATOR)
      const row = await Ctor.help({ path, rest: NO_REST, ctx })
      return { ...row, usage: callUsage(id) }
    }

    return { resolve, list, commands, command, describe }
  },
})
