import { Buffer } from 'node:buffer'
import { record } from '../document.js'
import { transformSpec } from './transform.js'

// TS 7.1 content mapper JSON-RPC, framed with byte-counted Content-Length.
const projects = new Set<string>()
let initialized = false
let buffer: Buffer = Buffer.alloc(0)

function dispatch(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
    case 'initialize':
      if (!Array.isArray(params.positionEncodings) || !params.positionEncodings.includes('utf-16'))
        throw new Error('This mapper requires UTF-16 position support')
      initialized = true
      return { positionEncoding: 'utf-16', diagnosticSource: 'openapi' }
    case 'openProject':
      if (!initialized || typeof params.projectHandle !== 'string')
        throw new Error('Initialize the mapper and supply a projectHandle first')
      projects.add(params.projectHandle)
      return {}
    case 'closeProject':
      projects.delete(String(params.projectHandle))
      return null
    case 'transform':
      if (!projects.has(String(params.projectHandle))) throw new Error('Unknown projectHandle')
      if (typeof params.content !== 'string' || typeof params.fileName !== 'string')
        throw new Error('Expected content and fileName strings')
      return transformSpec(params.content, params.fileName)
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

function respond(response: unknown) {
  const payload = Buffer.from(JSON.stringify(response))
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const match = /^Content-Length:\s*(\d+)\s*$/im.exec(buffer.subarray(0, end).toString('ascii'))
    const length = Number(match?.[1])
    if (!match || !Number.isSafeInteger(length) || length > 64 * 1024 * 1024) {
      process.stderr.write('Invalid content mapper frame\n')
      process.exit(1)
    }
    if (buffer.length < end + 4 + length) return
    const payload = buffer.subarray(end + 4, end + 4 + length)
    buffer = buffer.subarray(end + 4 + length)
    let id: string | number | null = null
    try {
      const request = record(JSON.parse(payload.toString('utf8')))
      if (
        request.jsonrpc !== '2.0' ||
        typeof request.method !== 'string' ||
        !['string', 'number'].includes(typeof request.id)
      )
        throw new Error('Invalid JSON-RPC request')
      id = request.id as string | number
      respond({ jsonrpc: '2.0', id, result: dispatch(request.method, record(request.params)) })
    } catch (error) {
      respond({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error) } })
    }
  }
})
