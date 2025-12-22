/**
 * Mock for ky HTTP client
 * This mock is used to avoid ESM issues in Vitest tests
 */
import type { Mock } from 'vitest'
import { vi } from 'vitest'

type KyResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: Headers
  json: Mock
  text: Mock
  blob: Mock
  arrayBuffer: Mock
  clone: Mock
}

type KyInstance = Mock & {
  get: Mock
  post: Mock
  put: Mock
  patch: Mock
  delete: Mock
  head: Mock
  create: Mock
  extend: Mock
  stop: symbol
}

const createResponse = (data: unknown = {}, status = 200): KyResponse => {
  const response: KyResponse = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    blob: vi.fn().mockResolvedValue(new Blob()),
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    clone: vi.fn(),
  }
  // Ensure clone returns a new response-like object, not the same instance
  response.clone.mockImplementation(() => createResponse(data, status))
  return response
}

const createKyInstance = (): KyInstance => {
  const instance = vi.fn().mockImplementation(() => Promise.resolve(createResponse())) as KyInstance

  // HTTP methods
  instance.get = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.post = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.put = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.patch = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.delete = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.head = vi.fn().mockImplementation(() => Promise.resolve(createResponse()))

  // Create new instance with custom options
  instance.create = vi.fn().mockImplementation(() => createKyInstance())
  instance.extend = vi.fn().mockImplementation(() => createKyInstance())

  // Stop method for AbortController
  instance.stop = Symbol('stop')

  return instance
}

const ky = createKyInstance()

export default ky
export { ky }
