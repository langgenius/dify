import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'

export function rpcProcess(command, args, cwd, timeoutMs = 15000) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  let buffer = Buffer.alloc(0)
  let sequence = 0
  const pending = new Map()
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.on('exit', (code) => {
    for (const { reject } of pending.values())
      reject(new Error(`RPC process exited (${code}): ${stderr}`))
  })
  function write(message) {
    const bytes = Buffer.from(JSON.stringify(message))
    child.stdin.write(`Content-Length: ${bytes.length}\r\n\r\n`)
    child.stdin.write(bytes)
  }
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1])
      if (buffer.length < end + 4 + length) return
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
      buffer = buffer.subarray(end + 4 + length)
      if (message.method && message.id !== undefined) {
        const result =
          message.method === 'workspace/configuration' ? message.params.items.map(() => null) : null
        write({ jsonrpc: '2.0', id: message.id, result })
      } else if (pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result)
      }
    }
  })
  return {
    notify(method, params) {
      write({ jsonrpc: '2.0', method, params })
    },
    request(method, params) {
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out: ${method}\n${stderr}`))
        }, timeoutMs)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          },
        })
        write({ jsonrpc: '2.0', id, method, params })
      })
    },
    close() {
      child.kill()
    },
  }
}
