import { render, waitFor } from '@testing-library/react'
import {
  REGISTRATION_SUCCESS_STORAGE_KEY,
  rememberRegistrationSuccess,
} from '@/app/components/base/amplitude/registration-tracking'
import { AmplitudeIdentitySync } from '../external-service-sync'

const { mockSetUserId, mockSetUserProperties, mockTrackEvent } = vi.hoisted(() => ({
  mockSetUserId: vi.fn(),
  mockSetUserProperties: vi.fn(),
  mockTrackEvent: vi.fn((..._args: unknown[]) => ({
    promise: Promise.resolve({ code: 200 }),
  })),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...original,
    useSuspenseQuery: () => ({
      data: {
        id: 'account-id',
        email: 'person@example.com',
        name: 'Person',
        is_password_set: true,
      },
    }),
  }
})

vi.mock('jotai', async (importOriginal) => {
  const original = await importOriginal<typeof import('jotai')>()
  return {
    ...original,
    useAtomValue: () => ({
      id: 'workspace-id',
      name: 'Workspace',
      plan: 'professional',
      role: 'owner',
    }),
  }
})

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({}),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  setUserId: (...args: unknown[]) => mockSetUserId(...args),
  setUserProperties: (...args: unknown[]) => mockSetUserProperties(...args),
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/app/components/base/amplitude/init', () => ({
  getIsAmplitudeInitialized: () => true,
}))

vi.mock('@/app/components/base/analytics-consent/consent-store', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/app/components/base/analytics-consent/consent-store')>()
  return {
    ...original,
    getAnalyticsConsent: () => 'granted',
  }
})

describe('AmplitudeIdentitySync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-4111-8111-111111111111',
    )
  })

  it('sets identity before flushing a marker that already exists', async () => {
    rememberRegistrationSuccess({ method: 'oauth' })

    render(<AmplitudeIdentitySync />)

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledTimes(1))
    expect(mockSetUserId).toHaveBeenCalledWith('person@example.com')
    expect(mockSetUserProperties).toHaveBeenCalledTimes(1)
    expect(mockSetUserId.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrackEvent.mock.invocationCallOrder[0]!,
    )
    expect(mockSetUserProperties.mock.invocationCallOrder[0]).toBeLessThan(
      mockTrackEvent.mock.invocationCallOrder[0]!,
    )
  })

  it('flushes a marker created after identity sync without repeating unchanged identity updates', async () => {
    render(<AmplitudeIdentitySync />)

    await waitFor(() => expect(mockSetUserId).toHaveBeenCalledTimes(1))
    expect(mockTrackEvent).not.toHaveBeenCalled()

    rememberRegistrationSuccess({ method: 'email' })

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledTimes(1))
    expect(mockSetUserId).toHaveBeenCalledTimes(1)
    expect(mockSetUserProperties).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(REGISTRATION_SUCCESS_STORAGE_KEY)).toBeNull()
  })
})
