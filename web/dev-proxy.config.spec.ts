/**
 * @vitest-environment node
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadDevProxyConfig } from '../packages/dev-proxy/src/config.ts'
import devProxyConfig from './dev-proxy.config'

const webRoot = fileURLToPath(new URL('.', import.meta.url))
const expectedDevProxyTarget = process.env.DEV_PROXY_TARGET || 'https://cloud.dify.ai'
const expectedDevProxyHost = process.env.DEV_PROXY_HOST || '127.0.0.1'
const expectedDevProxyPort = Number(process.env.DEV_PROXY_PORT || 5001)

describe('Dify dev proxy config', () => {
  // Scenario: the generic package loader should parse the Dify TS config file.
  it('should load through the dev proxy package config loader', async () => {
    // Act
    const config = await loadDevProxyConfig('dev-proxy.config.ts', webRoot)

    // Assert
    expect(config).toEqual(devProxyConfig)
  })

  // Scenario: the web app should explicitly configure the Dify API route set it consumes.
  it('should configure Dify console and public API routes', () => {
    // Assert
    expect(devProxyConfig.server).toEqual({
      host: expectedDevProxyHost,
      port: expectedDevProxyPort,
    })
    expect(devProxyConfig.routes.map(route => ({
      paths: route.paths,
      target: route.target,
    }))).toEqual([
      {
        paths: '/console/api',
        target: expectedDevProxyTarget,
      },
      {
        paths: '/api',
        target: expectedDevProxyTarget,
      },
    ])
  })

  // Scenario: Dify-specific cookie names should live in the Dify config, not in the generic package.
  it('should configure Dify cookie rewriting in web config', () => {
    // Assert
    expect(devProxyConfig.routes.every(route => route.cookieRewrite)).toBe(true)
    expect(devProxyConfig.routes[0]!.cookieRewrite).toEqual({
      hostPrefixCookieNames: [
        'access_token',
        'csrf_token',
        'refresh_token',
        'webapp_access_token',
      ],
      hostPrefixCookieNamePatterns: [/^passport-/],
    })
  })
})
