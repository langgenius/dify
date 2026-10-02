import type { CatalogOp } from '@/plugins/catalog'
import type { CommandConstructor } from '@/plugins/commands/command'
import type { CommandTree } from '@/plugins/commands/registry'
import { OP_SEPARATOR } from '@/protocol/op-id'
import { opCommand } from './command'

// A node is readonly once it is in a tree; building one needs a mutable view of it.
type BuildingNode = { command?: CommandConstructor; subcommands: Record<string, BuildingNode> }

export function opsTree(ops: Readonly<Record<string, CatalogOp>>): CommandTree {
  const tree: Record<string, BuildingNode> = {}
  for (const [id, op] of Object.entries(ops)) {
    const segments = id.split(OP_SEPARATOR)
    let level = tree
    for (const [index, segment] of segments.entries()) {
      const node = (level[segment] ??= { subcommands: {} })
      if (index === segments.length - 1) node.command = opCommand(id, op)
      level = node.subcommands
    }
  }
  return tree
}
