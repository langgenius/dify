import { generateMetadata as generateAgentsMetadata } from '../(commonLayout)/agents/page'
import { generateMetadata as generateWebappCheckCodeMetadata } from '../(shareLayout)/webapp-reset-password/check-code/layout'
import { generateMetadata as generateWebappResetPasswordMetadata } from '../(shareLayout)/webapp-reset-password/layout'
import { generateMetadata as generateWebappSetPasswordMetadata } from '../(shareLayout)/webapp-reset-password/set-password/layout'
import { generateMetadata as generateInitMetadata } from '../init/page'
import { generateMetadata as generateInstallMetadata } from '../install/layout'
import { generateMetadata as generateOAuthCallbackMetadata } from '../oauth-callback/layout'
import { generateMetadata as generateCheckCodeMetadata } from '../reset-password/check-code/layout'
import { generateMetadata as generateResetPasswordMetadata } from '../reset-password/layout'
import { generateMetadata as generateSetPasswordMetadata } from '../reset-password/set-password/layout'
import { generateMetadata as generateSignInCheckCodeMetadata } from '../signin/check-code/layout'
import { generateMetadata as generateSignInMetadata } from '../signin/page'
import { generateMetadata as generateSignupCheckCodeMetadata } from '../signup/check-code/layout'
import { generateMetadata as generateSignupMetadata } from '../signup/layout'
import { generateMetadata as generateSignupSetPasswordMetadata } from '../signup/set-password/layout'

vi.mock('server-only', () => ({}))

vi.mock('@/i18n-config/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n-config/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('../reset-password/reset-password-layout', () => ({ default: () => null }))
vi.mock('../signin/sign-in-page', () => ({ default: () => null }))
vi.mock('../signup/signup-layout', () => ({ default: () => null }))
vi.mock('../(shareLayout)/webapp-reset-password/reset-password-layout', () => ({
  default: () => null,
}))
vi.mock('../init/InitPasswordPopup', () => ({ default: () => null }))
vi.mock('@/features/agent-v2/roster/page', () => ({ default: () => null }))

describe('fixed authentication route metadata', () => {
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
