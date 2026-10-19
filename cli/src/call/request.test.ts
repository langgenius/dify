import type { CatalogOp } from '@/plugins/catalog'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { LOCAL_FILES } from '@/call/files'
import { parseCatalog } from '@/plugins/catalog'
import { buildRequest } from './request'

const doc = parseCatalog(readFileSync(join(__dirname, '../../test/fixtures/catalog.json')))
const run = doc.ops['run.console_app.workflow']!
const list = doc.ops['get.console_app']!
const readFile = async (p: string) => ({
  bytes: new TextEncoder().encode(`bytes-of-${p}`),
  name: p.split('/').pop() ?? p,
})
const FOLDERS: Readonly<Record<string, readonly string[]>> = {
  './pkg': ['a.yaml', 's/SKILL.md'],
  './junk': [],
  './brackets': ['x[1].txt'],
}
const listFolder = async (p: string) => FOLDERS[p]
const deps = { readFile, listFolder }

it('splits path, query and body', async () => {
  const req = await buildRequest(list, { workspace_id: 'ws 1', page: 2 }, deps)
  expect(req).toMatchObject({
    method: 'GET',
    path: '/openapi/v1/apps',
    query: { workspace_id: 'ws 1', page: '2' },
  })
  expect(req.json).toBeUndefined()
  const post = await buildRequest(
    run,
    { app_id: 'a/1', inputs: { q: 'hi' }, workflow_id: 'w' },
    deps,
  )
  expect(post.path).toBe('/openapi/v1/apps/a%2F1/workflow:run')
  expect(post.json).toEqual({ inputs: { q: 'hi' }, workflow_id: 'w' })
  expect(post.form).toBeUndefined()
})

it('switches to multipart when a file field is present', async () => {
  const req = await buildRequest(
    run,
    {
      app_id: 'a1',
      inputs: { q: 'x' },
      files: { doc: './r.pdf', pages: ['./1.png', './2.png'] },
      attachments: ['./att.txt'],
    },
    deps,
  )
  expect(req.json).toBeUndefined()
  const form = req.form!
  expect(form.get('inputs')).toBe('{"q":"x"}')
  expect((form.get('files[doc]') as File).name).toBe('r.pdf')
  expect(form.getAll('files[pages][]').map((f) => (f as File).name)).toEqual(['1.png', '2.png'])
  expect((form.get('attachments[]') as File).name).toBe('att.txt')
})

it('refuses unknown bind values and non-path file values before sending', async () => {
  const weird: CatalogOp = { ...run, bind: { ...run.bind, inputs: 'header' } }
  await expect(buildRequest(weird, { app_id: 'a', inputs: {} }, deps)).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('header'),
  })
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, files: { doc: 42 } }, deps),
  ).rejects.toMatchObject({ code: 'input_invalid' })
})

it('expands a folder into one part per file', async () => {
  const req = await buildRequest(run, { app_id: 'a', inputs: {}, attachments: './pkg' }, deps)
  const form = req.form!
  expect([...form.keys()]).toEqual(['inputs', 'attachments[a.yaml]', 'attachments[s/SKILL.md]'])
  expect((form.get('attachments[a.yaml]') as File).name).toBe('a.yaml')
  expect((form.get('attachments[s/SKILL.md]') as File).name).toBe('SKILL.md')
})

it('refuses a folder inside a list or a map', async () => {
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, files: { doc: './pkg' } }, deps),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: '"./pkg" is a folder; a folder can only be the whole value of files',
  })
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, attachments: ['./pkg'] }, deps),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('is a folder'),
  })
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, attachments: ['./junk'] }, deps),
  ).rejects.toMatchObject({ message: expect.stringContaining('is a folder') })
})

it('refuses an empty folder', async () => {
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, attachments: './junk' }, deps),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('folder "./junk" has no files'),
  })
})

it('refuses a bracket in a folder path', async () => {
  await expect(
    buildRequest(run, { app_id: 'a', inputs: {}, attachments: './brackets' }, deps),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: expect.stringContaining('x[1].txt'),
  })
})

it('keeps the missing-path error when the path is not a folder', async () => {
  const failing = async () => {
    throw new Error('ENOENT')
  }
  await expect(
    buildRequest(
      run,
      { app_id: 'a', inputs: {}, attachments: './nope' },
      { ...deps, readFile: failing },
    ),
  ).rejects.toMatchObject({
    code: 'input_invalid',
    message: 'cannot read file "./nope"',
  })
})

it('lists a plain whole-value path only once', async () => {
  const listed: string[] = []
  const counting = async (p: string) => {
    listed.push(p)
    return FOLDERS[p]
  }
  await buildRequest(
    run,
    { app_id: 'a', inputs: {}, attachments: './att.txt' },
    { ...deps, listFolder: counting },
  )
  expect(listed).toEqual(['./att.txt'])
})

it('sends a real folder through the local file deps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'difyctl-request-'))
  try {
    await writeFile(join(root, 'a.yaml'), 'app: 1')
    await mkdir(join(root, 's'))
    await writeFile(join(root, 's', 'SKILL.md'), '# skill')
    const req = await buildRequest(run, { app_id: 'a', inputs: {}, attachments: root }, LOCAL_FILES)
    const form = req.form!
    expect([...form.keys()]).toEqual(['inputs', 'attachments[a.yaml]', 'attachments[s/SKILL.md]'])
    const yaml = form.get('attachments[a.yaml]') as File
    const skill = form.get('attachments[s/SKILL.md]') as File
    expect([yaml.name, skill.name]).toEqual(['a.yaml', 'SKILL.md'])
    expect([await yaml.text(), await skill.text()]).toEqual(['app: 1', '# skill'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
