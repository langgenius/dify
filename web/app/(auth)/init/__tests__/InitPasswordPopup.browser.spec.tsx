import { ORPCError } from '@orpc/client'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import InitPasswordPopup from '../InitPasswordPopup'

const { validatePassword, getInitStatus, replace } = vi.hoisted(() => ({
  validatePassword: vi.fn(),
  getInitStatus: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'init.get': getInitStatus,
      'init.post': validatePassword,
    }),
  }
})
// boundary: Next.js navigation context is not mounted in a focused Browser Mode component render.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ replace }) }))

const renderPopup = () => {
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  return render(
    <ConsoleProvider>
      <InitPasswordPopup />
    </ConsoleProvider>,
  )
}

beforeEach(() => {
  validatePassword.mockReset()
  replace.mockReset()
  getInitStatus.mockReset().mockResolvedValue({ status: 'not_started' })
})

it('puts the cursor in the password field on arrival', async () => {
  const screen = await renderPopup()

  await expect.element(screen.getByLabelText('login.adminInitPassword')).toHaveFocus()
  await expect.poll(() => document.title).toBe('login.adminInitPassword - Dify')
})

it('asks for the password before submitting', async () => {
  const screen = await renderPopup()

  await userEvent.click(screen.getByRole('button', { name: 'login.validate' }))

  await expect
    .element(screen.getByLabelText('login.adminInitPassword'))
    .toHaveAccessibleDescription('login.error.passwordEmpty')
  expect(validatePassword).not.toHaveBeenCalled()
})

it('reports an incorrect password on the field until it is edited', async () => {
  validatePassword.mockRejectedValue(new ORPCError('init_validate_failed', { status: 401 }))
  const screen = await renderPopup()
  const password = screen.getByLabelText('login.adminInitPassword')

  await userEvent.fill(password, 'wrong')
  await userEvent.keyboard('{Enter}')

  await expect.element(password).toHaveAttribute('aria-invalid', 'true')
  await expect.element(password).toHaveAccessibleDescription('login.error.initPasswordIncorrect')

  await userEvent.type(password, '!')

  await expect.element(password).not.toHaveAttribute('aria-invalid', 'true')
  expect(replace).not.toHaveBeenCalled()
})

it('reports other failures inside the form until the password is edited', async () => {
  validatePassword.mockRejectedValue(new ORPCError('internal_error', { status: 500 }))
  const screen = await renderPopup()
  const password = screen.getByLabelText('login.adminInitPassword')

  await userEvent.fill(password, 'secret')
  await userEvent.keyboard('{Enter}')

  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await expect.element(password).not.toHaveAttribute('aria-invalid', 'true')

  await userEvent.type(password, '!')

  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
})

it('continues to install once after a correct password', async () => {
  validatePassword.mockResolvedValue({ result: 'success' })
  const screen = await renderPopup()

  await userEvent.fill(screen.getByLabelText('login.adminInitPassword'), 'correct')
  await userEvent.click(screen.getByRole('button', { name: 'login.validate' }))

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/install'))
  expect(replace).toHaveBeenCalledTimes(1)
})

it('sends an already validated instance to install', async () => {
  getInitStatus.mockResolvedValue({ status: 'finished' })

  await renderPopup()

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/install'))
  expect(validatePassword).not.toHaveBeenCalled()
})
