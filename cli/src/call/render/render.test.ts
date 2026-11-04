import type { CallFlags } from '@/call/flags'
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

function render(
  kind: string,
  res: Response,
  flags: CallFlags = {},
  input: Record<string, unknown> = {},
) {
  const buf = bufferStreams()
  const io = ioService(buf)
  return { buf, code: rendererFor(kind, io)(res, io, flags, { opId: OP_ID, input }) }
}

const BUN_SUFFIX = 'For more information, pass `verbose: true` in the second argument to fetch()'

function brokenSse(events: object[], message: string) {
  const chunks = events.map((e) => new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`))
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift()
        if (next === undefined) controller.error(new Error(message))
        else controller.enqueue(next)
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
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

it('a stream that breaks after the run started keeps its ids and hints at following the run', async () => {
  const r = render(
    'sse',
    brokenSse(
      [{ event: 'workflow_started', workflow_run_id: 'run-9', task_id: 'task-9', data: {} }],
      `The socket connection was closed unexpectedly. ${BUN_SUFFIX}`,
    ),
    {},
    { app_id: 'app-1', inputs: {} },
  )
  expect(await r.code).toBe(1)
  const result = JSON.parse(r.buf.outBuf())
  expect(result).toMatchObject({ status: 'incomplete', run_id: 'run-9', task_id: 'task-9' })
  expect(result.hints).toEqual([
    expect.objectContaining({ op: 'get.run.event', input: { app_id: 'app-1', run_id: 'run-9' } }),
  ])
  expect(result.hints[0].summary).toMatch(/still be running/)
})

it('a stream that breaks before any run id arrived gets no hint', async () => {
  const r = render(
    'sse',
    brokenSse([], 'The socket connection was closed unexpectedly.'),
    {},
    { app_id: 'app-1' },
  )
  expect(await r.code).toBe(1)
  expect(JSON.parse(r.buf.outBuf())).toMatchObject({ status: 'incomplete', hints: [] })
})

it('a chat run that breaks keeps its message id and gets no hint', async () => {
  const r = render(
    'sse',
    brokenSse([{ event: 'message', message_id: 'm-1', conversation_id: 'c-1', answer: 'hi' }], 'x'),
    {},
    { app_id: 'app-1' },
  )
  expect(await r.code).toBe(1)
  expect(JSON.parse(r.buf.outBuf())).toMatchObject({
    status: 'incomplete',
    message_id: 'm-1',
    conversation_id: 'c-1',
    hints: [],
  })
})

it('a broken stream that knows the run but not the app gets no hint', async () => {
  const r = render(
    'sse',
    brokenSse([{ event: 'workflow_started', workflow_run_id: 'run-9', data: {} }], 'x'),
  )
  expect(await r.code).toBe(1)
  expect(JSON.parse(r.buf.outBuf())).toMatchObject({ run_id: 'run-9', hints: [] })
})

it('an error after the terminal event leaves the finished run alone', async () => {
  const r = render(
    'sse',
    brokenSse(
      [
        { event: 'workflow_started', workflow_run_id: 'run-9', data: {} },
        { event: 'workflow_finished', data: { status: 'succeeded' } },
      ],
      'reset',
    ),
    {},
    { app_id: 'app-1' },
  )
  expect(await r.code).toBe(0)
  expect(JSON.parse(r.buf.outBuf())).toMatchObject({ status: 'ended', hints: [] })
})

it('a stream that closes cleanly before the run finished exits 1 with its own notice and hint', async () => {
  const r = render(
    'sse',
    sse([{ event: 'workflow_started', workflow_run_id: 'run-9', data: {} }]),
    {},
    { app_id: 'app-1' },
  )
  expect(await r.code).toBe(1)
  expect(r.buf.errBuf()).toBe('stream closed before the run finished\n')
  expect(JSON.parse(r.buf.outBuf()).hints).toEqual([
    expect.objectContaining({ op: 'get.run.event', input: { app_id: 'app-1', run_id: 'run-9' } }),
  ])
})

it('the stderr notice drops the runtime suffix and keeps the failure', async () => {
  const r = render(
    'sse',
    brokenSse([], `The socket connection was closed unexpectedly. ${BUN_SUFFIX}`),
  )
  await r.code
  expect(r.buf.errBuf()).toBe('stream ended early: The socket connection was closed unexpectedly\n')
})

it('a notice without the suffix is unchanged', async () => {
  const r = render('sse', brokenSse([], 'terminated'))
  await r.code
  expect(r.buf.errBuf()).toBe('stream ended early: terminated\n')
})

it('a stream that finished, paused or failed keeps its exit code', async () => {
  const ended = [{ event: 'workflow_finished', data: { status: 'succeeded' } }]
  expect(await render('sse', sse(ended)).code).toBe(0)
  const paused = [{ event: 'human_input_required', hints: [] }]
  expect(await render('sse', sse(paused)).code).toBe(0)
  const failed = [{ event: 'error', message: 'boom', code: 'x' }]
  expect(await render('sse', sse(failed)).code).toBe(1)
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
  ['../../escape.txt', 'escape.txt'],
  ['/etc/passwd', 'passwd'],
  ['..\\..\\win.txt', 'win.txt'],
  ['..', `${OP_ID}.txt`],
  ['dir/', 'dir'],
])('file keeps only the base name of the server filename %s', async (sent, kept) => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const cwd = process.cwd()
  process.chdir(dir)
  const here = process.cwd()
  try {
    const r = render(
      'file',
      new Response('x', {
        headers: {
          'content-type': 'text/plain',
          'content-disposition': `attachment; filename="${sent}"`,
        },
      }),
    )
    await r.code
    expect(JSON.parse(r.buf.outBuf())).toMatchObject({ path: join(here, kept) })
    expect(readFileSync(join(here, kept), 'utf8')).toBe('x')
  } finally {
    process.chdir(cwd)
  }
})

it('file refuses to overwrite an existing file it named itself, and keeps the old bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const cwd = process.cwd()
  process.chdir(dir)
  const here = join(process.cwd(), 'r.txt')
  writeFileSync(here, 'old')
  try {
    const r = render(
      'file',
      new Response('new', {
        headers: {
          'content-type': 'text/plain',
          'content-disposition': 'attachment; filename="r.txt"',
        },
      }),
    )
    await expect(r.code).rejects.toMatchObject({
      code: 'usage_missing_arg',
      message: `${here} already exists; not overwriting it`,
      hint: 'pass --output <path> to choose where to save it',
    })
    expect(readFileSync(here, 'utf8')).toBe('old')
    expect(r.buf.outBuf()).toBe('')
  } finally {
    process.chdir(cwd)
  }
})

it('file overwrites an existing file when --output names it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const out = join(dir, 'z.txt')
  writeFileSync(out, 'old')
  const r = render('file', new Response('new', { headers: { 'content-type': 'text/plain' } }), {
    output: out,
  })
  await r.code
  expect(readFileSync(out, 'utf8')).toBe('new')
})

it('file reports other write failures as a failed write, not an existing file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'difyctl-file-'))
  const out = join(dir, 'missing', 'z.txt')
  const r = render('file', new Response('x'), { output: out })
  await expect(r.code).rejects.toMatchObject({
    code: 'unknown',
    message: `failed to write file: ${out}`,
  })
})
