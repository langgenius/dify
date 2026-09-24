import type { Descriptor } from './describe'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { callOptionsSchema } from '@/call/flags'
import SkillsInstall from '@/commands/install/skills/index'
import { parseCatalog } from '@/plugins/catalog'
import { colorScheme } from '@/sys/io/color'
import { commandRow } from './describe'
import { helpMap } from './help'
import { descriptorView, exampleLine, fieldRows, listingView, mapView, SECTIONS } from './text'

const OPS = parseCatalog(readFileSync(join(__dirname, '../../../test/fixtures/catalog.json'))).ops
const plain = colorScheme(false)

function opDescriptor(id: string, path: readonly string[]): Descriptor {
  const op = OPS[id]
  if (op === undefined) throw new Error(`the catalog fixture has no op ${id}`)
  return {
    id: path.join(' '),
    usage: `difyctl ${path.join(' ')} [flags]`,
    summary: op.summary,
    effect: 'write',
    input: op.input,
    positional: [],
    examples: op.examples,
    op: id,
    method: op.method,
    path: op.path,
    kind: op.kind,
    bind: op.bind,
    deprecated: op.deprecated,
    options: callOptionsSchema(op.kind),
    pins: { workspace_id: 'ws-1' },
  }
}

const workflowRun = opDescriptor('run.console_app.workflow', ['run', 'console_app', 'workflow'])
const skillsInstall: Descriptor = commandRow(SkillsInstall, ['install', 'skills'])

it('sections are a table in one order, each skipped when it has no lines', () => {
  expect(SECTIONS.map((section) => section.title)).toEqual([
    'Usage',
    'Arguments',
    'Flags',
    'Options',
    'Global',
    'Examples',
    'Pins',
  ])
  expect(descriptorView(workflowRun).text(plain)).not.toContain('Arguments')
})

it('renders an op descriptor with input, options, global and examples', () => {
  expect(descriptorView(workflowRun).text(plain)).toMatchInlineSnapshot(`
    "run console_app workflow  Run a workflow app; streams workflow events  write sse

    Usage
      difyctl run console_app workflow [flags]

    Flags
      --app-id        string             required
      --attachments   file[]             optional  Local files attached to the run itself (the app's \`sys.files\`), not to a variable
      --files         map<string, json>  optional  Local files keyed by the app's file variable name; the server uploads each one and sets \`inputs[<name>]\`. Send a list (part name \`files[<name>][]\`) for a file-list variable
      --inputs        map<string, json>  required  Variables declared by the app. The exact shape is per app: read \`input_schema\` from describe.console_app. A file variable takes a Dify file mapping (remote url or upload id) here, or a local file in \`files\`, not both.
      --workflow-id   string             optional  Pin a published workflow version
      --workspace-id  string             optional  Workspace that owns the app

    Options
      --input   string    optional  Operation input as JSON, @file or @- for stdin
      --stream  boolean   optional  Print each event as it arrives
      --only    string[]  optional  Keep only these streamed events

    Global
      --verbose  boolean  false  Keep the raw server response in error envelopes
      --json     boolean  false  Print JSON even on a terminal

    Examples
      # Required fields
      difyctl run console_app workflow --app-id <app_id> --inputs <inputs>

    Pins
      workspace_id  ws-1"
  `)
})

it('renders a static descriptor with arguments and flags', () => {
  expect(descriptorView(skillsInstall).text(plain)).toMatchInlineSnapshot(`
    "install skills  Write skills from the collection into a skills root  write

    Usage
      difyctl install skills <dir> [flags]

    Arguments
      <dir>  string  required  The agent's skills root: the folder that holds one subfolder per skill

    Flags
      --skill  string[]  []  Skill to install (repeatable); default: the whole collection

    Global
      --verbose  boolean  false  Keep the raw server response in error envelopes
      --json     boolean  false  Print JSON even on a terminal

    Examples
      # Install every skill for Claude Code
      difyctl install skills ~/.claude/skills
      # Install one skill for Codex
      difyctl install skills ~/.codex/skills --skill difyctl"
  `)
})

it('example lines put positionals first, scalars as --flag value, non-scalars as json', () => {
  expect(
    exampleLine(workflowRun, { title: 't', input: { app_id: '<app_id>', inputs: { a: 1 } } }),
  ).toBe(`difyctl run console_app workflow --app-id <app_id> --inputs '{"a":1}'`)
  expect(
    exampleLine(skillsInstall, {
      title: 't',
      input: { dir: '~/.claude/skills', skill: ['difyctl'] },
    }),
  ).toBe('difyctl install skills ~/.claude/skills --skill difyctl')
})

it('a missing positional prints as itself and a non-scalar one as json', () => {
  const two: Descriptor = {
    id: 'thing do',
    usage: 'difyctl thing do <first> <second> [flags]',
    summary: 'Do a thing',
    input: {
      type: 'object',
      properties: { first: { type: 'string' }, second: { type: 'object' } },
    },
    positional: ['first', 'second'],
    examples: [],
  }
  expect(exampleLine(two, { title: 't', input: { second: { a: 1 } } })).toBe(
    `difyctl thing do <first> '{"a":1}'`,
  )
})

it('a tagless header carries no empty styled cell', () => {
  const color = colorScheme(true)
  const bare: Descriptor = {
    id: 'thing',
    usage: 'difyctl thing [flags]',
    summary: 'Do a thing',
    input: {},
    positional: [],
    examples: [],
  }
  expect(descriptorView(bare).text(color).split('\n')[0]).toBe(`${color.bold('thing')}  Do a thing`)
})

it('a boolean field is typed as its presence, not as a value', () => {
  const login: Descriptor = {
    id: 'login',
    usage: 'difyctl login [flags]',
    summary: 'Log in',
    input: { type: 'object', properties: { no_browser: { type: 'boolean', default: false } } },
    positional: [],
    examples: [],
  }
  expect(exampleLine(login, { title: 't', input: { no_browser: true } })).toBe(
    'difyctl login --no-browser',
  )
  expect(exampleLine(login, { title: 't', input: { no_browser: false } })).toBe(
    'difyctl login --no-browser=false',
  )
})

it('a description prints its first line only', () => {
  const schema = {
    type: 'object',
    required: ['note'],
    properties: {
      note: { type: 'string', description: 'What it does\n\nArgs:\n    note: a leaked docstring' },
      tries: { type: 'integer', default: 3, description: 'How many times' },
    },
  }
  expect(fieldRows(schema, [])).toEqual([
    {
      name: 'note',
      label: 'string',
      presence: 'required',
      description: 'What it does',
      positional: false,
    },
    {
      name: 'tries',
      label: 'integer',
      presence: '3',
      description: 'How many times',
      positional: false,
    },
  ])
})

it('an op without examples prints a skeleton of its required fields', () => {
  expect(workflowRun.examples).toEqual([])
  expect(descriptorView(workflowRun).text(plain)).toContain(
    'difyctl run console_app workflow --app-id <app_id> --inputs <inputs>',
  )
})

it('the map names each head, leaves by summary and groups by count', () => {
  const map = helpMap([
    { id: 'login', summary: 'Log in to a Dify server', effect: 'write' },
    { id: 'run console_app', summary: 'Run an app', kind: 'sse', deprecated: false },
    { id: 'run console_app chat', summary: 'Run a chat app', kind: 'sse', deprecated: false },
  ])
  expect(mapView(map).text(plain)).toMatchInlineSnapshot(`
    "login  Log in to a Dify server
    run    2 commands: console_app"
  `)
})

it('a listing is one aligned row per entry', () => {
  const listing = {
    entries: [
      {
        id: 'get console_app',
        summary: 'List apps',
        effect: 'read' as const,
        kind: 'list',
        deprecated: false,
      },
      {
        id: 'legacy_run console_app',
        summary: 'Deprecated: use the mode op',
        effect: 'write' as const,
        kind: 'sse',
        deprecated: true,
      },
    ],
    total: 2,
  }
  expect(listingView(listing).text(plain)).toMatchInlineSnapshot(`
    "get console_app         List apps                    read list
    legacy_run console_app  Deprecated: use the mode op  write sse deprecated"
  `)
})
