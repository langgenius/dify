import type { CommandConstructor } from '@/plugins/commands/command'
import type { CommandTree } from '@/plugins/commands/registry'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, normalize, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { commandTree } from '@/commands/tree.generated'
import { parseCatalog } from '@/plugins/catalog'
import { HELP_WORD } from '@/plugins/commands/command'
import { mergeTrees, nodeAt } from '@/plugins/commands/registry'
import { GLOBAL_INPUT } from '@/plugins/global-flags'
import { opsTree } from '@/plugins/ops/tree'
import { propertiesOf } from '@/protocol/shape'
import { propertyFor } from '@/util/flag-name'

const SKILL_DIR = fileURLToPath(new URL('../../../skills/difyctl/', import.meta.url))
const CATALOG = fileURLToPath(new URL('../fixtures/catalog.json', import.meta.url))
const ROOT_DOC = 'SKILL.md'
const MAX_HOPS = 2
const LEAF_DEPTH = MAX_HOPS
const MAP_MAX_LINES = 60
const TOC_AFTER_LINES = 100
const TOC_HEADING = '## Contents'
const H2 = /^## .*$/m
const LINK = /\]\(([^)#\s]+\.md)\)/g
const COMMAND = /`difyctl ([^`]+)`/g
const FENCE = /^(`{3,})/
const CONTINUATION = /\\\s*\n\s*/g
const CODE_COMMAND = /^difyctl (.+)$/
const PIPE = ' | '
const FLAG = /(?:^|\s)--([a-z][a-z0-9-]*)/g
const PLACEHOLDER = /^<[^>]+>$/
const WORD = /^[a-z_]+(?:-[a-z_]+)*$/
const DOTTED_ID = /^[a-z_]+(?:\.[a-z_]+)+$/
const SPAN = /`([^`]+)`/g
const NON_WORD_START = /^[-<]/
const GLOBAL_FLAGS = [...Object.keys(GLOBAL_INPUT.shape), HELP_WORD]

async function docs(): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(SKILL_DIR, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md'))
      out.push(relative(SKILL_DIR, join(entry.parentPath, entry.name)).split(sep).join('/'))
  }
  return out
}

function links(doc: string, text: string): string[] {
  return [...text.matchAll(LINK)].map((m) =>
    normalize(join(dirname(doc), m[1] as string))
      .split(sep)
      .join('/'),
  )
}

function depths(text: ReadonlyMap<string, string>): Map<string, number> {
  const depth = new Map([[ROOT_DOC, 0]])
  const queue = [ROOT_DOC]
  while (queue.length > 0) {
    const doc = queue.shift() as string
    for (const next of links(doc, text.get(doc) ?? '')) {
      if (depth.has(next)) continue
      depth.set(next, (depth.get(doc) as number) + 1)
      queue.push(next)
    }
  }
  return depth
}

/** `difyctl` command lines inside fenced code blocks, with `\` continuations joined. */
function fencedCommands(body: string): string[] {
  const code: string[] = []
  let fence: string | undefined
  for (const line of body.split('\n')) {
    const open = FENCE.exec(line.trim())?.[1]
    if (fence === undefined) {
      if (open !== undefined) fence = open
    } else if (open !== undefined && open.length >= fence.length && line.trim() === open) {
      fence = undefined
    } else {
      code.push(line)
    }
  }
  return code
    .join('\n')
    .replace(CONTINUATION, ' ')
    .split('\n')
    .map((line) => CODE_COMMAND.exec(line.trim())?.[1])
    .filter((span): span is string => span !== undefined)
}

function leadingWords(span: string): string[] {
  const words: string[] = []
  for (const word of span.split(' ')) {
    if (!WORD.test(word)) break
    words.push(word)
  }
  return words
}

/**
 * The commands a line names: the exact command, or — when a `<placeholder>` follows a
 * group — every command one word below it.
 */
function commandsNamed(tree: CommandTree, span: string, words: readonly string[]) {
  const node = nodeAt(tree, words)
  if (node === undefined) return []
  if (node.command !== undefined) return [node.command]
  if (!PLACEHOLDER.test(span.split(' ')[words.length] ?? '')) return []
  return Object.values(node.subcommands)
    .map((child) => child.command)
    .filter((command): command is CommandConstructor => command !== undefined)
}

function flagsOf(command: CommandConstructor): string[] {
  return [...Object.keys(propertiesOf(command.flags())), ...GLOBAL_FLAGS]
}

function typedFlags(span: string): string[] {
  return [...(span.split(PIPE)[0] as string).matchAll(FLAG)].map((m) => propertyFor(m[1] as string))
}

describe('skills/difyctl tree', async () => {
  const all = await docs()
  const text = new Map(
    await Promise.all(
      all.map(async (d) => [d, await readFile(join(SKILL_DIR, d), 'utf8')] as const),
    ),
  )
  const catalog = parseCatalog(await readFile(CATALOG)).ops
  const ops = Object.keys(catalog)
  const { tree } = mergeTrees(commandTree, opsTree(catalog))
  const depth = depths(text)
  const commands = [...text].flatMap(([doc, body]) => [
    ...[...body.matchAll(COMMAND)].map((m) => ({ doc, span: m[1] as string })),
    ...fencedCommands(body).map((span) => ({ doc, span })),
  ])

  it('every relative link resolves', () => {
    for (const [doc, body] of text)
      for (const target of links(doc, body)) expect(all, `${doc} → ${target}`).toContain(target)
  })

  it('every doc is reachable within two hops of SKILL.md', () => {
    for (const doc of all) {
      expect(depth.has(doc), `${doc} unreachable`).toBe(true)
      expect(depth.get(doc) as number, doc).toBeLessThanOrEqual(MAX_HOPS)
    }
  })

  it('maps stay short and leaves link only to siblings', () => {
    for (const [doc, body] of text) {
      if ((depth.get(doc) as number) < LEAF_DEPTH) {
        expect(body.split('\n').length, doc).toBeLessThan(MAP_MAX_LINES)
        continue
      }
      for (const target of links(doc, body))
        expect(dirname(target), `${doc} → ${target}`).toBe(dirname(doc))
    }
  })

  it('long leaves open with contents', () => {
    for (const [doc, body] of text) {
      if ((depth.get(doc) as number) < LEAF_DEPTH) continue
      if (body.split('\n').length <= TOC_AFTER_LINES) continue
      expect(H2.exec(body)?.[0], doc).toBe(TOC_HEADING)
    }
  })

  it('every difyctl command exists locally or in the catalog', () => {
    for (const { doc, span } of commands) {
      const words = leadingWords(span)
      if (words.length === 0) {
        expect(span, `${doc}: difyctl ${span} names no command`).toMatch(NON_WORD_START)
        continue
      }
      const found = words[0] === HELP_WORD || nodeAt(tree, words) !== undefined
      expect(found, `${doc}: difyctl ${span}`).toBe(true)
    }
  })

  it('every flag on a command is one that command parses', () => {
    for (const { doc, span } of commands) {
      const named = commandsNamed(tree, span, leadingWords(span))
      if (named.length === 0) continue
      const allowed = new Set(named.flatMap(flagsOf))
      for (const flag of typedFlags(span))
        expect(allowed.has(flag), `${doc}: difyctl ${span}: ${flag}`).toBe(true)
    }
  })

  it('every dotted op id exists in the catalog', () => {
    const verbs = new Set(ops.map((op) => op.split('.')[0]))
    for (const [doc, body] of text) {
      for (const m of body.matchAll(SPAN)) {
        const span = m[1] as string
        if (!DOTTED_ID.test(span) || !verbs.has(span.split('.')[0])) continue
        expect(ops, `${doc}: ${span}`).toContain(span)
      }
    }
  })
})
