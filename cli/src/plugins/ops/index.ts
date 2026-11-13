import type { CatalogOp, CatalogService } from '@/plugins/catalog'
import type { CommandTree } from '@/plugins/commands/registry'
import { definePlugin } from '@/kernel/plugin'
import { catalog } from '@/plugins/catalog'
import { http } from '@/plugins/http'
import { session } from '@/plugins/session'
import { opsTree } from './tree'

export type ListOptions = Readonly<{ includeInternal: boolean }>

export type TreeOptions = ListOptions & Readonly<{ fresh: boolean }>

export type OpsService = {
  readonly commands: (opts: TreeOptions) => Promise<CommandTree>
}

function shown(
  ops: Readonly<Record<string, CatalogOp>>,
  opts: ListOptions,
): Readonly<Record<string, CatalogOp>> {
  return Object.fromEntries(
    Object.entries(ops).filter(([, op]) => opts.includeInternal || !op.internal),
  )
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

    const commands: OpsService['commands'] = async (opts) =>
      opsTree(shown(opts.fresh ? await refresh() : (await loaded()).ops(), opts))

    return { commands }
  },
})
