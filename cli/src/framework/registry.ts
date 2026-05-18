import type { CommandConstructor } from './command.js'

export type CommandNode = {
  readonly command?: CommandConstructor
  readonly subcommands: Record<string, CommandNode>
}

export type CommandTree = Record<string, CommandNode>

function buildPath(parts: string[]): string {
  return parts.join(' ')
}

export function resolveCommand(
  tree: CommandTree,
  argv: string[],
): { command: CommandConstructor, path: string[] } | undefined {
  const path: string[] = []
  let node: CommandNode | undefined
  let lastMatch: { command: CommandConstructor, path: string[] } | undefined

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined || token.startsWith('-'))
      break

    const next = path.length === 0 ? tree[token] : node?.subcommands[token]
    if (!next)
      break

    node = next
    path.push(token)

    if (node.command) {
      lastMatch = { command: node.command, path: [...path] }
      const nextToken = argv[i + 1]
      if (nextToken === undefined || nextToken.startsWith('-') || !(nextToken in node.subcommands))
        return lastMatch
    }
  }

  return lastMatch
}

export function findSuggestions(tree: CommandTree, argv: string[]): string[] {
  const suggestions: string[] = []
  const path: string[] = []
  let node: CommandNode | undefined

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined || token.startsWith('-'))
      break

    if (path.length === 0) {
      node = tree[token]
    }
    else {
      node = node?.subcommands[token]
    }

    if (!node) {
      const parent = path.length === 0 ? tree : resolveParent(tree, path)
      if (parent) {
        for (const key of Object.keys(parent)) {
          suggestions.push(buildPath([...path, key]))
        }
      }

      return suggestions
    }

    path.push(token)
  }

  if (node) {
    for (const key of Object.keys(node.subcommands)) {
      suggestions.push(buildPath([...path, key]))
    }
  }

  return suggestions
}

function resolveParent(tree: CommandTree, path: string[]): Record<string, CommandNode> | undefined {
  if (path.length === 0)
    return tree

  let node: CommandNode | undefined

  for (let i = 0; i < path.length; i++) {
    const token = path[i]
    if (token === undefined)
      return undefined

    if (i === 0) {
      node = tree[token]
    }
    else {
      node = node?.subcommands[token]
    }

    if (!node)
      return undefined
  }

  return node?.subcommands
}
