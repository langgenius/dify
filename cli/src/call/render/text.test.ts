import { Buffer } from 'node:buffer'
import { expect, it } from 'vite-plus/test'
import { ioService } from '@/plugins/io'
import { bufferStreams } from '@/sys/io/streams'
import { textRenderer } from './text'

it('writes the first response bytes before the server finishes the body', async () => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const res = new Response(
    new ReadableStream<Uint8Array>({
      start(current) {
        controller = current
        current.enqueue(new Uint8Array([0xe4, 0xb8]))
      },
    }),
  )
  const streams = bufferStreams()
  const io = ioService(streams)
  const writes: Buffer[] = []
  let onWrite: () => void = () => {}
  const firstWrite = new Promise<void>((resolve) => {
    onWrite = resolve
  })
  const output = {
    ...io,
    raw: async (chunk: string | Buffer) => {
      writes.push(Buffer.from(chunk))
      onWrite()
    },
  }
  const result = textRenderer(res, output, {}, 'export.text')
  const arrivedBeforeEnd = await Promise.race([
    firstWrite.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  controller!.enqueue(new Uint8Array([0xad, 0xff]))
  controller!.close()
  expect(await result).toBe(0)
  expect(arrivedBeforeEnd).toBe(true)
  expect(Buffer.concat(writes)).toEqual(Buffer.from([0xe4, 0xb8, 0xad, 0xff]))
})

it('cancels the unread response when the output rejects a write', async () => {
  let cancelled = false
  let controller: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(current) {
      controller = current
      current.enqueue(new Uint8Array([1, 2, 3]))
    },
    cancel() {
      cancelled = true
    },
  })
  const error = new Error('output closed')
  const io = {
    ...ioService(bufferStreams()),
    raw: async () => {
      throw error
    },
  }
  const result = textRenderer(new Response(body), io, {}, 'export.text')
  const settled = await Promise.race([
    result.catch((cause: unknown) => cause),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 100)),
  ])
  if (settled === false) {
    // Release a buffering implementation after the regression's observation window.
    controller!.close()
  }
  await result.catch(() => {})
  expect(settled).toBe(error)
  expect(cancelled).toBe(true)
})
