import type { StubServer } from '@test/fixtures/stub-server'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testHttpClient } from '@test/fixtures/http-client'
import { jsonResponder, startStubServer } from '@test/fixtures/stub-server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isHttpClientError } from '@/errors/base'
import { FileUploadClient } from './file-upload.js'

const UPLOADED = {
  id: 'file-1',
  name: 'hello.png',
  size: 5,
  extension: 'png',
  mime_type: 'image/png',
}

function makeClient(host: string): FileUploadClient {
  return new FileUploadClient(testHttpClient(host, 'dfoa_test'))
}

describe('FileUploadClient.upload', () => {
  let stub: StubServer
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'difyctl-upload-'))
  })

  afterEach(async () => {
    await stub?.stop()
    await rm(dir, { recursive: true, force: true })
  })

  it('POSTs multipart/form-data (boundary intact, no JSON content-type) and returns the parsed file', async () => {
    const filePath = join(dir, 'hello.png')
    await writeFile(filePath, 'hello')
    stub = await startStubServer(cap => jsonResponder(200, UPLOADED, cap))

    const result = await makeClient(stub.url).upload('app-1', filePath)

    expect(stub.captured.method).toBe('POST')
    expect(stub.captured.url).toBe('/openapi/v1/apps/app-1/files')
    // The client must let fetch own the multipart Content-Type + boundary; it
    // must NOT coerce this to application/json the way a json body would.
    const contentType = stub.captured.headers?.['content-type'] ?? ''
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
    // Bearer still applied on the upload path.
    expect(stub.captured.headers?.authorization).toBe('Bearer dfoa_test')
    // The multipart payload carries the filename and the file bytes.
    expect(stub.captured.body).toContain('filename="hello.png"')
    expect(stub.captured.body).toContain('hello')
    expect(result.id).toBe('file-1')
  })

  it('encodes the app id in the path', async () => {
    const filePath = join(dir, 'a.txt')
    await writeFile(filePath, 'x')
    stub = await startStubServer(cap => jsonResponder(200, UPLOADED, cap))

    await makeClient(stub.url).upload('app/with space', filePath)

    expect(stub.captured.url).toBe('/openapi/v1/apps/app%2Fwith%20space/files')
  })

  it('propagates a server 413 as a classified BaseError', async () => {
    const filePath = join(dir, 'big.bin')
    await writeFile(filePath, 'data')
    stub = await startStubServer(cap => jsonResponder(413, { error: 'file too large' }, cap))

    await expect(makeClient(stub.url).upload('app-1', filePath)).rejects.toSatisfy(
      err => isHttpClientError(err) && err.httpStatus === 413,
    )
  })
})
