/**
 * Mock for ky HTTP client
 * This mock is used to avoid ESM issues in Jest tests
 */

type KyResponse = {
  ok: boolean
  status: number
  statusText: string
  headers: Headers
  json: jest.Mock
  text: jest.Mock
  blob: jest.Mock
  arrayBuffer: jest.Mock
  clone: jest.Mock
}

type KyInstance = jest.Mock & {
  get: jest.Mock
  post: jest.Mock
  put: jest.Mock
  patch: jest.Mock
  delete: jest.Mock
  head: jest.Mock
  create: jest.Mock
  extend: jest.Mock
  stop: symbol
}

const createResponse = (data: unknown = {}, status = 200): KyResponse => {
  const response: KyResponse = {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
    blob: jest.fn().mockResolvedValue(new Blob()),
    arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    clone: jest.fn(),
  }
  // Ensure clone returns a new response-like object, not the same instance
  response.clone.mockImplementation(() => createResponse(data, status))
  return response
}

const createKyInstance = (): KyInstance => {
  const instance = jest.fn().mockImplementation(() => Promise.resolve(createResponse())) as KyInstance

  // HTTP methods
  instance.get = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.post = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.put = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.patch = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.delete = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))
  instance.head = jest.fn().mockImplementation(() => Promise.resolve(createResponse()))

  // Create new instance with custom options
  instance.create = jest.fn().mockImplementation(() => createKyInstance())
  instance.extend = jest.fn().mockImplementation(() => createKyInstance())

  // Stop method for AbortController
  instance.stop = Symbol('stop')

  return instance
}

const ky = createKyInstance()

export default ky
export { ky }
