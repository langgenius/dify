import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  getAnonymousWebAppPassport,
  getAuthenticatedWebAppPassport,
  setWebAppPassport,
  startWebAppAccountSession,
} from '../webapp-auth'
import {
  claimWebAppMigration,
  getWebAppMigrationTarget,
  loadWebAppMigrationCandidates,
} from './migration'

const migrationClient = vi.hoisted(() => ({
  postClaimablePassports: vi.fn(),
  postClaim: vi.fn(),
}))

vi.mock('./index', () => ({
  webAppClient: {
    migration: {
      claimablePassports: { post: migrationClient.postClaimablePassports },
      claim: { post: migrationClient.postClaim },
    },
  },
}))

describe('Web App migration', () => {
  beforeEach(() => {
    localStorage.clear()
    migrationClient.postClaimablePassports.mockReset()
    migrationClient.postClaim.mockReset()
  })

  it('maps each claimable response index to its local anonymous Passport across batches', async () => {
    for (let index = 0; index < 51; index += 1)
      setWebAppPassport({ kind: 'default', code: `app-${index}` }, `passport-${index}`, 'anonymous')
    migrationClient.postClaimablePassports
      .mockResolvedValueOnce({
        data: [
          {
            index: 0,
            app_code: 'app-0',
            app_name: 'App 0',
            connection_count: 1,
            conversation_count: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            index: 0,
            app_code: 'app-50',
            app_name: 'App 50',
            connection_count: 0,
            conversation_count: 3,
          },
        ],
      })

    const candidates = await loadWebAppMigrationCandidates()

    expect(migrationClient.postClaimablePassports).toHaveBeenCalledTimes(2)
    expect(candidates.find(({ app_code }) => app_code === 'app-0')).toMatchObject({
      credential: { passport: 'passport-0' },
    })
    expect(candidates.find(({ app_code }) => app_code === 'app-50')).toMatchObject({
      credential: { passport: 'passport-50' },
    })
  })

  it('routes a signed-in App with anonymous data to the migration confirmation page', () => {
    const returnUrl = `${window.location.origin}/chat/app-a?conversationId=conversation-a`
    setWebAppPassport({ kind: 'default', code: 'app-a' }, 'anonymous-a', 'anonymous')

    const target = new URL(getWebAppMigrationTarget(returnUrl))

    expect(target.pathname).toBe('/chat/app-a/migrate-conversations')
    expect(target.searchParams.get('redirect_url')).toBe(returnUrl)
  })

  it('keeps failed anonymous Passports for retry and removes only successfully claimed local Passports', async () => {
    const appA = { kind: 'default', code: 'app-a' } as const
    const appB = { kind: 'default', code: 'app-b' } as const
    setWebAppPassport(appA, 'anonymous-a', 'anonymous')
    setWebAppPassport(appB, 'anonymous-b', 'anonymous')
    startWebAppAccountSession()
    const candidates = [
      {
        index: 0,
        app_code: 'app-a',
        app_name: 'App A',
        connection_count: 0,
        conversation_count: 2,
        credential: {
          key: 'passport-app-a',
          passport: 'anonymous-a',
        },
      },
      {
        index: 1,
        app_code: 'app-b',
        app_name: 'App B',
        connection_count: 1,
        conversation_count: 0,
        credential: {
          key: 'passport-app-b',
          passport: 'anonymous-b',
        },
      },
    ]
    migrationClient.postClaim.mockResolvedValue({
      data: [
        {
          status: 'success',
          index: 0,
          app_code: 'app-a',
          access_token: 'account-passport-a',
          claimed_connections: 0,
          claimed_conversations: 2,
          stop_requested_run_count: 0,
        },
        {
          status: 'failed',
          index: 1,
          error: { code: 'end_user_busy', message: 'Try again.', status: 409 },
        },
      ],
    })

    await expect(claimWebAppMigration(candidates)).rejects.toThrow('Try again.')

    expect(getAnonymousWebAppPassport(appA)).toBe('')
    expect(getAuthenticatedWebAppPassport(appA)).toBe('')
    expect(getAnonymousWebAppPassport(appB)).toBe('anonymous-b')
    expect(getAuthenticatedWebAppPassport(appB)).toBe('')
  })
})
