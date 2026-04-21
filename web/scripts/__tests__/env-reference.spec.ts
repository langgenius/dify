/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { buildFrontendEnvReference, renderFrontendEnvReferenceMarkdown } from '../env-reference.mjs'

describe('frontend env reference', () => {
  it('should derive frontend authority metadata from web/env.ts only', () => {
    // Arrange
    const reference = buildFrontendEnvReference()
    const variables = Object.fromEntries(reference.variables.map(variable => [variable.name, variable]))

    // Assert
    expect(reference.authority.source_root).toBe('web')
    expect(reference.authority.model).toBe('web/env.ts')
    expect(variables.NEXT_PUBLIC_API_PREFIX).toBeDefined()
    expect(variables.HONO_PROXY_HOST).toBeUndefined()
    expect(variables.HONO_CONSOLE_API_PROXY_TARGET).toBeUndefined()
  })

  it('should export browser-public dataset metadata for client env variables', () => {
    // Arrange
    const reference = buildFrontendEnvReference()
    const variable = reference.variables.find(item => item.name === 'NEXT_PUBLIC_API_PREFIX')

    // Assert
    expect(variable).toEqual({
      name: 'NEXT_PUBLIC_API_PREFIX',
      accepted_names: ['NEXT_PUBLIC_API_PREFIX'],
      runtime: 'client',
      visibility: 'browser-public',
      type: 'string',
      description: 'The base URL of console application, refers to the Console base URL of WEB service if console domain is different from api or web app domain. example: http://cloud.dify.ai/console/api',
      code_default: null,
      required: false,
      injection_mode: 'body-dataset',
      dataset_key: 'apiPrefix',
    })
  })

  it('should export server-only process env metadata for server variables', () => {
    // Arrange
    const reference = buildFrontendEnvReference()
    const variable = reference.variables.find(item => item.name === 'PORT')

    // Assert
    expect(variable).toEqual({
      name: 'PORT',
      accepted_names: ['PORT'],
      runtime: 'server',
      visibility: 'server-only',
      type: 'integer',
      description: '',
      code_default: 3000,
      required: false,
      injection_mode: 'process-env',
      dataset_key: null,
    })
  })

  it('should render markdown that excludes deploy defaults and explains the scope', () => {
    // Arrange
    const markdown = renderFrontendEnvReferenceMarkdown(buildFrontendEnvReference())

    // Assert
    expect(markdown).toContain('> Generated from `web/env.ts`. Do not edit manually.')
    expect(markdown).toContain('Deploy-time defaults, `.env.example`, Docker files, and runtime-effective values are intentionally excluded.')
    expect(markdown).toContain('Only env declared in `web/env.ts` is included. Dev-only tooling env outside that file is excluded.')
    expect(markdown).toContain('| `NEXT_PUBLIC_API_PREFIX` | `browser-public` | `string` | `""` | `body-dataset` | `apiPrefix` |')
    expect(markdown).toContain('| `PORT` | `server-only` | `integer` | `3000` | `process-env` |  |  |')
    expect(markdown).not.toContain('HONO_PROXY_HOST')
  })
})
