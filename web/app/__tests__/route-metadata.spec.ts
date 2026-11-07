import { generateMetadata as generateInitMetadata } from '../(auth)/init/page'
import { generateMetadata as generateInstallMetadata } from '../(auth)/install/layout'
import { generateMetadata as generateCheckCodeMetadata } from '../(auth)/reset-password/check-code/layout'
import { generateMetadata as generateResetPasswordMetadata } from '../(auth)/reset-password/layout'
import { generateMetadata as generateSetPasswordMetadata } from '../(auth)/reset-password/set-password/layout'
import { generateMetadata as generateSignInCheckCodeMetadata } from '../(auth)/signin/check-code/layout'
import { generateMetadata as generateSignInMetadata } from '../(auth)/signin/page'
import { generateMetadata as generateSignupCheckCodeMetadata } from '../(auth)/signup/check-code/layout'
import { generateMetadata as generateSignupMetadata } from '../(auth)/signup/layout'
import { generateMetadata as generateSignupSetPasswordMetadata } from '../(auth)/signup/set-password/layout'
import { generateMetadata as generateAgentsMetadata } from '../(commonLayout)/agents/page'
import { generateMetadata as generateAppsMetadata } from '../(commonLayout)/apps/page'
import { generateMetadata as generateHomeMetadata } from '../(commonLayout)/page'
import { generateMetadata as generateWebappCheckCodeMetadata } from '../(shareLayout)/webapp-reset-password/check-code/layout'
import { generateMetadata as generateWebappResetPasswordMetadata } from '../(shareLayout)/webapp-reset-password/layout'
import { generateMetadata as generateWebappSetPasswordMetadata } from '../(shareLayout)/webapp-reset-password/set-password/layout'
import { generateMetadata as generateOAuthCallbackMetadata } from '../oauth-callback/layout'

vi.mock('server-only', () => ({}))

vi.mock('@/i18n/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/service/console/server', () => ({ resolveServerConsoleApiUrl: () => null }))
vi.mock('@/features/account-profile/server', () => ({ serverUserProfileQueryOptions: vi.fn() }))
vi.mock('../(auth)/signin/sign-in-page', () => ({ default: () => null }))
vi.mock('../(auth)/init/InitPasswordPopup', () => ({ default: () => null }))
vi.mock('@/app/components/apps', () => ({ Apps: () => null }))
vi.mock('@/features/agent-v2/roster/page', () => ({ default: () => null }))
vi.mock('@/features/home/page', () => ({ HomePage: () => null }))

describe('fixed route metadata', () => {
  it.each([
    [generateResetPasswordMetadata, 'Reset Password'],
    [generateCheckCodeMetadata, 'Check your email'],
    [generateSetPasswordMetadata, 'Set a password'],
    [generateWebappResetPasswordMetadata, 'Reset Password'],
    [generateWebappCheckCodeMetadata, 'Check your email'],
    [generateWebappSetPasswordMetadata, 'Set a password'],
    [generateSignupMetadata, 'Create your account'],
    [generateSignupCheckCodeMetadata, 'Check your email'],
    [generateSignupSetPasswordMetadata, 'Set a password'],
    [generateSignInCheckCodeMetadata, 'Check your email'],
    [generateInstallMetadata, 'Setting up an admin account'],
    [generateInitMetadata, 'Admin initialization password'],
    [generateOAuthCallbackMetadata, 'Sign in'],
    [generateAgentsMetadata, 'Agents'],
    [generateAppsMetadata, 'Studio'],
    [generateHomeMetadata, 'Home'],
  ])('provides the localized title %s', async (generateMetadata, expectedTitle) => {
    await expect(generateMetadata()).resolves.toMatchObject({ title: expectedTitle })
  })
})

describe('sign-in route metadata', () => {
  it.each([
    [undefined, 'Sign in'],
    ['next', 'One more step'],
    [['next', 'ignored'], 'One more step'],
  ])('uses the request-visible step %s', async (step, expectedTitle) => {
    await expect(
      generateSignInMetadata({ searchParams: Promise.resolve({ step }) }),
    ).resolves.toMatchObject({ title: expectedTitle })
  })
})
