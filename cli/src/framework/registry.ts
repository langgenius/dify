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

function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i]
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? (prev[j - 1] ?? 0)
        : 1 + Math.min(prev[j] ?? 0, curr[j - 1] ?? 0, prev[j - 1] ?? 0)
    }
    prev = curr
  }
  return prev[n] ?? 0
}

export function findSuggestions(tree: CommandTree, argv: string[]): string[] {
  const results: string[] = []

  function collectAll(node: CommandNode, path: string[]): void {
    if (node.command)
      results.push(buildPath(path))
    for (const [key, child] of Object.entries(node.subcommands))
      collectAll(child, [...path, key])
  }

  function traverse(nodes: Record<string, CommandNode>, tokens: string[], path: string[]): void {
    const token = tokens[0]
    if (token === undefined || token.startsWith('-'))
      return

    const rest = tokens.slice(1)
    const nextToken = rest.at(0)
    for (const [key, node] of Object.entries(nodes)) {
      if (editDistance(token, key) <= 1) {
        const newPath = [...path, key]
        if (nextToken === undefined || nextToken.startsWith('-') || Object.keys(node.subcommands).length === 0) {
          collectAll(node, newPath)
        }
        else {
          traverse(node.subcommands, rest, newPath)
        }
      }
    }
  }

  traverse(tree, argv, [])
  return results
}
