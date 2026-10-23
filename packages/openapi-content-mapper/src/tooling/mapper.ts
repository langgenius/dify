import { Buffer } from 'node:buffer'
import { record } from '../document.js'
import { readFrames } from './framing.js'
import { mapperTransform } from './mapper-cache.js'

// TS 7.1 content mapper JSON-RPC, framed with byte-counted Content-Length.
const projects = new Set<string>()
let initialized = false
const transform = mapperTransform()

async function dispatch(method: string, params: Record<string, unknown>): Promise<string> {
  switch (method) {
    case 'initialize':
      if (!Array.isArray(params.positionEncodings) || !params.positionEncodings.includes('utf-16'))
        throw new Error('This mapper requires UTF-16 position support')
      initialized = true
      return JSON.stringify({ positionEncoding: 'utf-16', diagnosticSource: 'openapi' })
    case 'openProject':
      if (!initialized || typeof params.projectHandle !== 'string')
        throw new Error('Initialize the mapper and supply a projectHandle first')
      projects.add(params.projectHandle)
      return '{}'
    case 'closeProject':
      projects.delete(String(params.projectHandle))
      return 'null'
    case 'transform':
      if (!projects.has(String(params.projectHandle))) throw new Error('Unknown projectHandle')
      if (typeof params.content !== 'string' || typeof params.fileName !== 'string')
        throw new Error('Expected content and fileName strings')
      return transform(params.content, params.fileName)
    default:
      throw new Error(`Unknown method: ${method}`)
  }
}

function respond(response: string) {
  const payload = Buffer.from(response)
  process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`)
  process.stdout.write(payload)
}

async function main() {
  for await (const payload of readFrames(process.stdin)) {
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
      const result = await dispatch(request.method, record(request.params))
      respond(`{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":${result}}`)
    } catch (error) {
      respond(
        JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: String(error) } }),
      )
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
