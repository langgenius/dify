/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseDevProxyCliArgs, resolveDevProxyServerOptions, resolveDevProxyTarget } from './config'

describe('dev proxy config', () => {
  // Scenario: CLI options should support both inline and separated values.
  it('should parse proxy CLI options', () => {
    // Act
    const options = parseDevProxyCliArgs([
      '--target=enterprise',
      '--host',
      '0.0.0.0',
      '--port',
      '8083',
    ])

    // Assert
    expect(options).toEqual({
      host: '0.0.0.0',
      port: '8083',
      proxyTarget: 'enterprise',
    })
  })

  // Scenario: the default Dify proxy keeps the existing 5001 port.
  it('should resolve the default Dify proxy server options', () => {
    // Act
    const options = resolveDevProxyServerOptions()

    // Assert
    expect(options).toEqual({
      host: '127.0.0.1',
      port: 5001,
      proxyTarget: 'dify',
    })
  })

  // Scenario: Enterprise frontend defaults to the Enterprise gateway port.
  it('should use port 8082 by default for enterprise proxy target', () => {
    // Act
    const options = resolveDevProxyServerOptions({}, {
      proxyTarget: 'enterprise',
    })

    // Assert
    expect(options).toEqual({
      host: '127.0.0.1',
      port: 8082,
      proxyTarget: 'enterprise',
    })
  })

  // Scenario: explicit ports should override target-specific defaults.
  it('should allow env and CLI ports to override the default port', () => {
    // Act
    const envOptions = resolveDevProxyServerOptions({
      HONO_PROXY_PORT: '9001',
      HONO_PROXY_TARGET: 'enterprise',
    })
    const cliOptions = resolveDevProxyServerOptions({
      HONO_PROXY_PORT: '9001',
      HONO_PROXY_TARGET: 'enterprise',
    }, {
      port: '9002',
    })

    // Assert
    expect(envOptions.port).toBe(9001)
    expect(cliOptions.port).toBe(9002)
  })

  // Scenario: unsupported proxy targets should fail before the server starts.
  it('should reject unsupported proxy targets', () => {
    // Assert
    expect(() => resolveDevProxyTarget('unknown')).toThrow('Unsupported proxy target')
  })
})
