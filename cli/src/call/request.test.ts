import type { CatalogOp } from '@/plugins/catalog'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { parseCatalog } from '@/plugins/catalog'
import { buildRequest } from './request'

const doc = parseCatalog(readFileSync(join(__dirname, '../../test/fixtures/catalog.json')))
const run = doc.ops['console_app.workflow.run']!
const list = doc.ops['console_app.list']!
const readFile = async (p: string) => ({
  bytes: new TextEncoder().encode(`bytes-of-${p}`),
  name: p.split('/').pop() ?? p,
})
const deps = { readFile }

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
