/**
 * @vitest-environment node
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadDevProxyConfig, parseDevProxyCliArgs, resolveDevProxyServerOptions } from './config'

const tempDirs: string[] = []

const createTempDir = async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-proxy-test-'))
  tempDirs.push(tempDir)
  return tempDir
}

describe('dev proxy config', () => {
  afterEach(async () => {
    delete process.env.DEV_PROXY_TEST_PORT
    delete process.env.DEV_PROXY_TEST_TARGET

    await Promise.all(tempDirs.splice(0).map(tempDir => fs.rm(tempDir, {
      force: true,
      recursive: true,
    })))
  })

  // Scenario: CLI options should support both inline and separated values.
  it('should parse proxy CLI options', () => {
    // Act
    const options = parseDevProxyCliArgs([
      '--config=./dev-proxy.config.ts',
      '--env-file',
      './.env.proxy',
      '--host',
      '0.0.0.0',
      '--port',
      '8083',
    ])

    // Assert
    expect(options).toEqual({
      config: './dev-proxy.config.ts',
      envFile: './.env.proxy',
      host: '0.0.0.0',
      port: '8083',
    })
  })

  // Scenario: removed target shortcuts should fail instead of silently doing the wrong thing.
  it('should reject unsupported target shortcuts', () => {
    // Assert
    expect(() => parseDevProxyCliArgs(['--target', 'enterprise'])).toThrow('Unsupported dev proxy option')
  })

  // Scenario: package manager argument separators should not be treated as proxy options.
  it('should ignore package manager argument separators', () => {
    // Act
    const options = parseDevProxyCliArgs(['--config', './dev-proxy.config.ts', '--', '--help'])

    // Assert
    expect(options).toEqual({
      config: './dev-proxy.config.ts',
      help: true,
    })
  })

  // Scenario: CLI host and port should override config defaults.
  it('should resolve server options with CLI overrides', () => {
    // Act
    const options = resolveDevProxyServerOptions({
      host: '127.0.0.1',
      port: 5001,
    }, {
      host: '0.0.0.0',
      port: '9002',
    })

    // Assert
    expect(options).toEqual({
      host: '0.0.0.0',
      port: 9002,
    })
  })

  // Scenario: TS config files should load through c12.
  it('should load a TypeScript config file', async () => {
    // Arrange
    const tempDir = await createTempDir()
    await fs.writeFile(path.join(tempDir, 'dev-proxy.config.ts'), `
      export default {
        server: { host: '127.0.0.1', port: 7777 },
        routes: [{ paths: ['/api', '/files'], target: 'https://api.example.com' }],
      }
    `)

    // Act
    const config = await loadDevProxyConfig('dev-proxy.config.ts', tempDir)

    // Assert
    expect(config.server).toEqual({
      host: '127.0.0.1',
      port: 7777,
    })
    expect(config.routes).toEqual([
      {
        paths: ['/api', '/files'],
        target: 'https://api.example.com',
      },
    ])
  })

  // Scenario: env files should be loaded before the TypeScript config is evaluated.
  it('should load a TypeScript config file with env file values', async () => {
    // Arrange
    const tempDir = await createTempDir()
    await fs.writeFile(path.join(tempDir, '.env.proxy'), [
      'DEV_PROXY_TEST_PORT=7788',
      'DEV_PROXY_TEST_TARGET=https://env.example.com',
    ].join('\n'))
    await fs.writeFile(path.join(tempDir, 'dev-proxy.config.ts'), `
      export default {
        server: { port: Number(process.env.DEV_PROXY_TEST_PORT) },
        routes: [{ paths: '/api', target: process.env.DEV_PROXY_TEST_TARGET }],
      }
    `)

    // Act
    const config = await loadDevProxyConfig('dev-proxy.config.ts', tempDir, {
      envFile: '.env.proxy',
    })

    // Assert
    expect(config.server).toEqual({
      port: 7788,
    })
    expect(config.routes).toEqual([
      {
        paths: '/api',
        target: 'https://env.example.com',
      },
    ])
  })
})
