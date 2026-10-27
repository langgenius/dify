import { settingsSaveErrorMessageKey } from '../save-error'

describe('settings save error messages', () => {
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
