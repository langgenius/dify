import type { CommandConstructor } from './command'
import { dottedId } from '@/protocol/op-id'
import { editDistance } from '@/util/edit-distance'
import { propertyFor } from '@/util/flag-name'

export type CommandNode = {
  readonly command?: CommandConstructor
  readonly subcommands: Record<string, CommandNode>
}

export type CommandTree = Record<string, CommandNode>

export type ResolvedCommand = { command: CommandConstructor; path: string[] }

export type MergedTree = { tree: CommandTree; shadowed: string[] }

/** `hidden` keeps a command out of listings; a help view may ask for it back. */
export type CollectOptions = Readonly<{ includeHidden: boolean }>

const LISTED_ONLY: CollectOptions = { includeHidden: false }

function buildPath(parts: string[]): string {
  return parts.join(' ')
}

// A command word may be typed with dashes where the id spells underscores; the path
// keeps the key it matched, so what is echoed back is the canonical spelling.
function childOf(
  level: Record<string, CommandNode>,
  token: string,
): { key: string; node: CommandNode } | undefined {
  for (const key of [token, propertyFor(token)]) {
    const node = level[key]
    if (node !== undefined) return { key, node }
  }
  return undefined
}

export function resolveCommand(tree: CommandTree, argv: string[]): ResolvedCommand | undefined {
  const path: string[] = []
  let node: CommandNode | undefined
  let lastMatch: ResolvedCommand | undefined

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === undefined || token.startsWith('-')) break

    const next = childOf(path.length === 0 ? tree : (node?.subcommands ?? {}), token)
    if (next === undefined) break

    node = next.node
    path.push(next.key)

    if (node.command) {
      lastMatch = { command: node.command, path: [...path] }
      const nextToken = argv[i + 1]
      if (
        nextToken === undefined ||
        nextToken.startsWith('-') ||
        childOf(node.subcommands, nextToken) === undefined
      )
        return lastMatch
    }
  }

  return lastMatch
}

/** The node these words name, command or bare group; undefined when the tree has none. */
export function nodeAt(tree: CommandTree, path: readonly string[]): CommandNode | undefined {
  let node: CommandNode | undefined
  for (const token of path) {
    const next = childOf(node === undefined ? tree : node.subcommands, token)
    if (next === undefined) return undefined
    node = next.node
  }
  return node
}

export function collectCommands(
  tree: CommandTree,
  opts: CollectOptions = LISTED_ONLY,
): Array<{ command: CommandConstructor; path: string[] }> {
  const results: Array<{ command: CommandConstructor; path: string[] }> = []

  function walk(node: CommandNode, path: string[]): void {
    if (node.command && (opts.includeHidden || node.command.hidden !== true))
      results.push({ command: node.command, path })
    for (const [key, child] of Object.entries(node.subcommands)) walk(child, [...path, key])
  }

  for (const [key, node] of Object.entries(tree)) walk(node, [key])

  return results
}

// Static wins: the op stays reachable through `call <id>` and is reported so a
// snapshot test can flag the collision.
export function mergeTrees(statics: CommandTree, added: CommandTree): MergedTree {
  const shadowed: string[] = []

  function fold(base: CommandTree, extra: CommandTree, path: readonly string[]): CommandTree {
    const merged: Record<string, CommandNode> = { ...base }
    for (const [key, node] of Object.entries(extra)) {
      const here = [...path, key]
      const existing = merged[key]
      if (existing === undefined) {
        merged[key] = node
        continue
      }
      if (existing.command !== undefined && node.command !== undefined)
        shadowed.push(dottedId(here))
      merged[key] = {
        command: existing.command ?? node.command,
        subcommands: fold(existing.subcommands, node.subcommands, here),
      }
    }
    return merged
  }

  return { tree: fold(statics, added, []), shadowed }
}

// Below MAX_SCORE a score decomposes uniquely into (integer spelling cost,
// 1.5 × omitted namespaces), so scoreFallback's ambiguity guard can read
// `spelling === 0` as "exact leaf, only the namespace was omitted".
const OMIT_PENALTY = 1.5
const MAX_SCORE = 3

function relThreshold(token: string): number {
  return token.length <= 3 ? 1 : 2
}

function positionalTokens(argv: string[]): string[] {
  const tokens: string[] = []
  for (const token of argv) {
    if (token.startsWith('-')) break
    tokens.push(token)
  }
  return tokens
}

// Minimum total edit distance to align `tokens` as an ordered subsequence of
// `segments`, every matched pair within its length-aware threshold. Returns
// null when no alignment exists (e.g. more tokens than segments).
function minSubsequenceCost(tokens: string[], segments: string[]): number | null {
  const [head, ...rest] = tokens
  if (head === undefined) return 0

  const threshold = relThreshold(head)
  let best: number | null = null
  for (const [index, segment] of segments.entries()) {
    const cost = editDistance(head, segment)
    if (cost > threshold) continue
    const tail = minSubsequenceCost(rest, segments.slice(index + 1))
    if (tail !== null && (best === null || cost + tail < best)) best = cost + tail
  }
  return best
}

// Recovers a wrong/omitted namespace by scoring the typed tokens against the
// flat command list. The last token must align to a candidate's leaf; earlier
// tokens align, in order, to the candidate's preceding segments (the rest are
// namespace the user omitted). Lower score = higher confidence.
function scoreFallback(tree: CommandTree, tokens: string[]): string[] {
  const last = tokens.length - 1
  const lastToken = tokens[last]
  if (lastToken === undefined) return []
  const prefix = tokens.slice(0, last)

  const scored: Array<{ path: string; score: number; spelling: number; depth: number }> = []
  for (const { path } of collectCommands(tree)) {
    const leaf = path[path.length - 1] ?? ''
    const leafCost = editDistance(lastToken, leaf)
    if (leafCost > relThreshold(lastToken)) continue

    const prefixCost = minSubsequenceCost(prefix, path.slice(0, -1))
    if (prefixCost === null) continue

    const spelling = leafCost + prefixCost
    const score = spelling + OMIT_PENALTY * (path.length - tokens.length)
    if (score >= MAX_SCORE) continue

    scored.push({ path: buildPath(path), score, spelling, depth: path.length })
  }

  if (scored.length === 0) return []

  scored.sort((a, b) => a.score - b.score || a.depth - b.depth || a.path.localeCompare(b.path))

  // An exact leaf living under several namespaces is unroutable — staying silent
  // beats guessing an arbitrary one.
  const best = scored[0]?.score
  const tied = scored.filter((item) => item.score === best)
  if (tied.length >= 2 && tied.every((item) => item.spelling === 0)) return []

  return scored.map((item) => item.path)
}

export function findSuggestions(tree: CommandTree, argv: string[]): string[] {
  const results: string[] = []

  function collectAll(node: CommandNode, path: string[]): void {
    if (node.command && node.command.hidden !== true) results.push(buildPath(path))
    for (const [key, child] of Object.entries(node.subcommands)) collectAll(child, [...path, key])
  }

  function traverse(nodes: Record<string, CommandNode>, tokens: string[], path: string[]): void {
    const token = tokens[0]
    if (token === undefined || token.startsWith('-')) return

    const rest = tokens.slice(1)
    const nextToken = rest.at(0)
    for (const [key, node] of Object.entries(nodes)) {
      if (editDistance(token, key) <= 1) {
        const newPath = [...path, key]
        if (
          nextToken === undefined ||
          nextToken.startsWith('-') ||
          Object.keys(node.subcommands).length === 0
        ) {
          collectAll(node, newPath)
        } else {
          traverse(node.subcommands, rest, newPath)
        }
      }
    }
  }

  // Same-level typos and namespace listing first; only fall back to
  // cross-namespace scoring when the level-by-level walk finds nothing.
  traverse(tree, argv, [])
  if (results.length > 0) return results

  return scoreFallback(tree, positionalTokens(argv))
}
