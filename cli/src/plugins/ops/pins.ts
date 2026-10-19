import type { BuildContext } from '@/kernel/plugin'
import type { CatalogOp } from '@/plugins/catalog'
import { session } from '@/plugins/session'
import { PIN } from '@/protocol/pins'
import { propertiesOf } from '@/protocol/shape'

type PinValues = Record<string, string | null>

/** What the CLI would fill in from the local session, or undefined if the op takes none. */
export async function pinsFor(
  op: CatalogOp,
  ctx: BuildContext<typeof session>,
): Promise<PinValues | undefined> {
  if (!(PIN.Workspace in propertiesOf(op.input))) return undefined
  return { [PIN.Workspace]: await (await ctx.get(session)).workspaceId() }
}
