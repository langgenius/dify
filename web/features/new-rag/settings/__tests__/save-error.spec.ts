import { settings } from '@dify/contracts/api/console/knowledge-fs/orpc.gen'
import { validateDefinedErrors } from '@/service/console/defined-errors'
import { createHttpError } from '@/service/http-error'
import { settingsSaveErrorMessageKey } from '../save-error'

describe('settings save error messages', () => {
  it.each([
    [
      409,
      'knowledge_fs_conflict',
      'KNOWLEDGE_SPACE_SETTINGS_COMPILATION_IN_PROGRESS',
      'conflict',
      'settings.compilationInProgress',
    ],
    [
      422,
      'knowledge_fs_request_rejected',
      'MODEL_CREDENTIAL_INVALID',
      'configuration',
      'taskFailure.modelConfiguration',
    ],
    [
      503,
      'knowledge_fs_operation_unavailable',
      'MODEL_PREFLIGHT_TIMEOUT',
      'timeout',
      'taskFailure.modelService',
    ],
  ] as const)(
    'preserves HTTP %s %s failure guidance through the generated contract',
    async (status, code, failureCode, category, key) => {
      const failure = {
        code: failureCode,
        category,
        retryPolicy: 'manual',
        message: 'Private provider detail must not become UI copy',
      }
      const body = { code, status, message: failure.message, details: failure, failure }
      const error = await validateDefinedErrors({ settings })({
        context: {},
        input: undefined,
        path: ['settings', 'patch'],
        next: () => Promise.reject(createHttpError(new Response(null, { status }), body)),
      }).catch((rejected: unknown) => rejected)

      expect(error).toMatchObject({ defined: true, data: { details: failure } })
      expect(await settingsSaveErrorMessageKey(error)).toBe(key)
    },
  )

  it.each([
    ['KNOWLEDGE_SPACE_SETTINGS_COMPILATION_IN_PROGRESS', 'settings.compilationInProgress'],
    ['KNOWLEDGE_SPACE_SETTINGS_REVISION_CONFLICT', 'settings.revisionConflict'],
    ['KNOWLEDGE_SPACE_SETTINGS_MIGRATION_REQUIRED', 'settings.migrationRequired'],
    ['MODEL_CREDENTIAL_INVALID', 'taskFailure.modelConfiguration'],
    ['MODEL_PREFLIGHT_TIMEOUT', 'taskFailure.modelService'],
  ])('maps %s without exposing internal messages', async (code, key) => {
    const response = new Response(
      JSON.stringify({
        failure: {
          code,
          category: 'conflict',
          retryPolicy: 'manual',
          message: 'private provider detail',
        },
      }),
      { status: 409 },
    )
    expect(await settingsSaveErrorMessageKey(response)).toBe(key)
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    new Error('private'),
    new Response('invalid JSON', { status: 409 }),
    new Response(JSON.stringify({ failure: { code: 'UNKNOWN', message: 'private' } }), {
      status: 409,
    }),
  ])('safely handles malformed errors', async (error) => {
    expect(await settingsSaveErrorMessageKey(error)).toBe('settings.saveFailed')
  })

  it('uses the permission message for forbidden settings', async () => {
    expect(await settingsSaveErrorMessageKey(new Response(null, { status: 403 }))).toBe(
      'permissionRestricted',
    )
  })
})
