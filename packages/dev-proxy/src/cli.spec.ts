/**
 * @vitest-environment node
 */
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
type DevProxyCliProcess = ChildProcessByStdio<null, Readable, Readable>

const childProcesses: DevProxyCliProcess[] = []
const binPath = fileURLToPath(new URL('../bin/dev-proxy.js', import.meta.url))

const createTempDir = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-proxy-cli-test-'))
  tempDirs.push(tempDir)
  return tempDir
}

const getFreePort = async () => {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Failed to allocate a test port.')

  const { port } = address
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error)
        reject(error)
      else
        resolve()
    })
  })

  return port
}

const waitForOutput = (
  child: DevProxyCliProcess,
  output: () => string,
  expectedOutput: string,
) => new Promise<void>((resolve, reject) => {
  let timeout: ReturnType<typeof setTimeout>

  function cleanup() {
    clearTimeout(timeout)
    child.stdout.off('data', onData)
    child.stderr.off('data', onData)
    child.off('exit', onExit)
  }

  function onData() {
    if (!output().includes(expectedOutput))
      return

    cleanup()
    resolve()
  }

  function onExit(code: number | null, signal: NodeJS.Signals | null) {
    cleanup()
    reject(new Error(`dev-proxy exited before writing "${expectedOutput}" with code ${code} and signal ${signal}. Output:\n${output()}`))
  }

  timeout = setTimeout(() => {
    cleanup()
    reject(new Error(`Timed out waiting for "${expectedOutput}". Output:\n${output()}`))
  }, 3000)

  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.once('exit', onExit)
  onData()
})

const spawnCli = (args: readonly string[], cwd: string) => {
  const child = spawn(process.execPath, [binPath, ...args], {
    cwd,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  childProcesses.push(child)
  return child
}

const stopChildProcess = async (child: DevProxyCliProcess) => {
  if (child.exitCode !== null || child.signalCode !== null)
    return

  child.kill('SIGTERM')
  await once(child, 'exit')
}

describe('dev proxy CLI', () => {
  afterEach(async () => {
    await Promise.all(childProcesses.splice(0).map(stopChildProcess))
    await Promise.all(tempDirs.splice(0).map(tempDir => fs.rm(tempDir, {
      force: true,
      recursive: true,
    })))
  })

  // Scenario: help output should still be a normal short-lived command.
  it('should print help and exit', async () => {
    // Arrange
    const tempDir = await createTempDir()
    const child = spawnCli(['--help'], tempDir)

    // Act
    const [code] = await once(child, 'exit')

    // Assert
    expect(code).toBe(0)
  })

  // Scenario: successful server startup should keep the CLI process alive.
  it('should keep running after starting the proxy server', async () => {
    // Arrange
    const tempDir = await createTempDir()
    const port = await getFreePort()
    await fs.writeFile(path.join(tempDir, 'dev-proxy.config.ts'), `
      export default {
        routes: [{ paths: '/api', target: 'https://api.example.com' }],
      }
    `)

    let output = ''
    const child = spawnCli(['--config', './dev-proxy.config.ts', '--host', '127.0.0.1', '--port', String(port)], tempDir)
    child.stdout.on('data', chunk => output += chunk.toString())
    child.stderr.on('data', chunk => output += chunk.toString())

    // Act
    await waitForOutput(child, () => output, `[dev-proxy] listening on http://127.0.0.1:${port}`)
    await new Promise(resolve => setTimeout(resolve, 100))
    const response = await fetch(`http://127.0.0.1:${port}/not-proxied`)

    // Assert
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
    expect(response.status).toBe(404)
  })
})
