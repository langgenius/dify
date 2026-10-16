import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test'
import { DifyClient } from '../src/client/base'

describe('upload user fields', () => {
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk))
      }
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] ?? '' },
        body: new Uint8Array(Buffer.concat(chunks)),
      })
      const form = await request.formData()
      const file = form.get('file') as File
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          users: form.getAll('user'),
          fileName: file.name,
          fileText: await file.text(),
          extra: form.get('extra'),
        }),
      )
    })().catch(() => {
      res.writeHead(500)
      res.end()
    })
  })

  let client: DifyClient
  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    client = new DifyClient({
      apiKey: 'test',
      baseUrl: `http://127.0.0.1:${address.port}`,
      maxRetries: 0,
    })
  })
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  const makeForm = () => {
    const form = new FormData()
    form.append('file', new Blob(['payload']), 'sample.txt')
    form.append('extra', 'preserved')
    return form
  }

  it.each(['fileUpload', 'audioToText'] as const)(
    '%s replaces existing user fields',
    async (method) => {
      const form = makeForm()
      form.append('user', 'stale-user')
      form.append('user', 'another-user')

      const response = await client[method](form, 'current-user')

      expect(response.data).toEqual({
        users: ['current-user'],
        fileName: 'sample.txt',
        fileText: 'payload',
        extra: 'preserved',
      })
    },
  )

  it.each(['fileUpload', 'audioToText'] as const)(
    '%s can reuse native FormData for a new user',
    async (method) => {
      const form = makeForm()
      const first = await client[method](form, 'first-user')
      expect(first.data.users).toEqual(['first-user'])

      const second = await client[method](form, 'second-user')
      expect(second.data.users).toEqual(['second-user'])
      expect(second.data.fileText).toBe('payload')
    },
  )
})
