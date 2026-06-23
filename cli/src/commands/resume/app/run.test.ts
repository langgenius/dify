import type { ActiveContext } from '@/auth/hosts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRunClient } from '@/api/app-run'
import { AppsClient } from '@/api/apps'
import { PermittedExternalAppsClient } from '@/api/permitted-external-apps'
import { bufferStreams } from '@/sys/io/streams'
import { resumeApp } from './run.js'

const DESCRIBE_RESULT = {
  info: { id: 'app-2', name: 'X', mode: 'workflow', description: '', updated_at: null, service_api_enabled: true, is_agent: false },
  parameters: null,
  input_schema: null,
}

const FORM_RESP = { user_actions: [{ id: 'submit' }] }

function makeExternalActive(): ActiveContext {
  return {
    host: 'http://localhost',
    email: 'sso@x.io',
    ctx: {
      account: { id: 'acct-1', email: 'sso@x.io', name: 'SSO User' },
      external_subject: { email: 'sso@x.io', issuer: 'https://issuer.example.com' },
    },
  } as unknown as ActiveContext
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resumeApp pre-flight subject strategy', () => {
  it('external login: mode pre-flight calls PermittedExternalAppsClient.describe, not AppsClient.describe', async () => {
    const externalDescribe = vi.fn().mockResolvedValue(DESCRIBE_RESULT)
    const externalSpy = vi.spyOn(PermittedExternalAppsClient.prototype, 'describe').mockImplementation(externalDescribe)
    const accountSpy = vi.spyOn(AppsClient.prototype, 'describe')

    vi.spyOn(AppRunClient.prototype, 'submitHumanInput').mockResolvedValue(undefined as never)

    const io = bufferStreams()
    const http = {
      baseURL: 'http://localhost',
      request: vi.fn().mockImplementation((opts: { path: string }) => {
        if (typeof opts.path === 'string' && opts.path.includes('form/human_input')) {
          return Promise.resolve(FORM_RESP)
        }
        // reconnect stream — return an async iterable that ends immediately
        const iter: AsyncIterable<never> = { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined as never }) }) }
        return Promise.resolve(iter)
      }),
    } as unknown as import('@/http/types').HttpClient

    try {
      await resumeApp(
        { appId: 'app-2', formToken: 'ft-1', workflowRunId: 'wf-run-1', action: 'submit', inputs: {} },
        { active: makeExternalActive(), http, host: 'http://localhost', io },
      )
    }
    catch {
      // run may fail after pre-flight due to stream mock; we only check which describe was called
    }

    expect(externalSpy).toHaveBeenCalled()
    expect(accountSpy).not.toHaveBeenCalled()
  })
})
