import type { CallFlags } from '@/call/flags'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { ioService } from '@/plugins/io'
import { bufferStreams } from '@/sys/io/streams'
import { rendererFor } from './index'

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })

const OP_ID = 'thing.export'

function render(kind: string, res: Response, flags: CallFlags = {}) {
  const buf = bufferStreams()
  const io = ioService(buf)
  return { buf, code: rendererFor(kind, io)(res, io, flags, OP_ID) }
}

it('object and list print the body unchanged, hints included', async () => {
  const a = render('object', Response.json({ a: 1 }))
  expect(await a.code).toBe(0)
  expect(JSON.parse(a.buf.outBuf())).toEqual({ a: 1 })
  const body = {
    page: 1,
    limit: 2,
    total: 5,
    has_more: true,
    data: [],
    hints: [{ summary: 'Next page', op: 'x.y', input: { page: 2, limit: 2 } }],
  }
  const b = render('list', Response.json(body))
  await b.code
  expect(JSON.parse(b.buf.outBuf())).toEqual(body)
})

it('object rejects a non-JSON body as a server error and writes nothing', async () => {
  const res = new Response('<html>', { headers: { 'content-type': 'text/html' } })
  const r = render('object', res)
  await expect(r.code).rejects.toMatchObject({ code: 'server_error' })
  expect(r.buf.outBuf()).toBe('')
})

it('sse folds by default and streams with --stream --only', async () => {
  const events = [
    { event: 'message', answer: 'hi' },
    { event: 'node_finished', data: { id: 'n' } },
    { event: 'message_end', message_id: 'm' },
  ]
  const a = render('sse', sse(events))
  expect(await a.code).toBe(0)
  expect(JSON.parse(a.buf.outBuf())).toMatchObject({
    status: 'ended',
    text: { answer: 'hi' },
    message_id: 'm',
  })
  const b = render('sse', sse(events), { stream: true, only: ['node_finished'] })
  await b.code
  expect(
    b.buf
      .outBuf()
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l)),
  ).toEqual([{ event: 'node_finished', data: { id: 'n' } }])
})

it('sse exit code follows the fold in both modes', async () => {
  const events = [{ event: 'error', message: 'boom', code: 'x' }]
  expect(await render('sse', sse(events)).code).toBe(1)
  expect(await render('sse', sse(events), { stream: true }).code).toBe(1)
})

it('unknown kind renders as object with one warning line', async () => {
  const r = render('hologram', Response.json({ z: 1 }))
  expect(await r.code).toBe(0)
  expect(r.buf.errBuf()).toMatch(/unknown kind hologram/)
})

it('text writes raw; file writes to --output and prints the receipt', async () => {
  const t = render('text', new Response('a: 1\n', { headers: { 'content-type': 'text/plain' } }))
  await t.code
  expect(t.buf.outBuf()).toBe('a: 1\n')
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const out = join(dir, 'x.bin')
  const f = render(
    'file',
    new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': 'attachment; filename="r.bin"',
      },
    }),
    { output: out },
  )
  await f.code
  expect(readFileSync(out)).toEqual(Buffer.from([1, 2, 3]))
  expect(JSON.parse(f.buf.outBuf())).toEqual({
    path: out,
    size: 3,
    content_type: 'application/octet-stream',
  })
})

it('file omits content_type when the server sent none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const out = join(dir, 'y.bin')
  const res = new Response(new Uint8Array([7]))
  res.headers.delete('content-type')
  const r = render('file', res, { output: out })
  await r.code
  expect(JSON.parse(r.buf.outBuf())).toEqual({ path: out, size: 1 })
})

it('file names an unnamed download after the op and its content type', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const cwd = process.cwd()
  process.chdir(dir)
  const here = process.cwd()
  try {
    const yaml = render(
      'file',
      new Response('a: 1', { headers: { 'content-type': 'application/x-yaml' } }),
    )
    await yaml.code
    expect(JSON.parse(yaml.buf.outBuf())).toMatchObject({ path: join(here, `${OP_ID}.yaml`) })
    const blob = render(
      'file',
      new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/vnd.unknown' } }),
    )
    await blob.code
    expect(JSON.parse(blob.buf.outBuf())).toMatchObject({ path: join(here, `${OP_ID}.bin`) })
  } finally {
    process.chdir(cwd)
  }
})

it.each([
  ["attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.zip", '\u6D4B\u8BD5.zip'],
  [
    "attachment; filename=export.zip; filename*=UTF-8'en'%E6%B5%8B%E8%AF%95.zip",
    '\u6D4B\u8BD5.zip',
  ],
  ["attachment; FILENAME*=utf-8''report%20%2B%20100%25.zip", 'report + 100%.zip'],
  ["attachment; filename*=UTF-8''broken%ZZ.zip; filename=fallback.zip", 'fallback.zip'],
  ["attachment; filename*=UTF-8''%FF.zip; filename=fallback.zip", 'fallback.zip'],
  ["attachment; filename*=UTF-8''; filename=fallback.zip", 'fallback.zip'],
  ["attachment; filename*=UTF-8''dir%2Freport.zip; filename=fallback.zip", 'fallback.zip'],
  ['attachment; filename=report%20name.zip', 'report%20name.zip'],
  ["attachment; filename*=ISO-8859-1''%A3.zip; filename=fallback.zip", 'fallback.zip'],
])('file resolves download names from %s', async (disposition, filename) => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-filename-'))
  const cwd = process.cwd()
  process.chdir(dir)
  const here = process.cwd()
  try {
    const r = render(
      'file',
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-disposition': disposition },
      }),
    )
    expect(await r.code).toBe(0)
    const path = join(here, filename)
    expect(JSON.parse(r.buf.outBuf())).toMatchObject({ path, size: 3 })
    expect(readFileSync(path)).toEqual(Buffer.from([1, 2, 3]))
  } finally {
    process.chdir(cwd)
  }
})
