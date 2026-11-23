import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import InitPasswordPopup from '../InitPasswordPopup'

const replace = vi.hoisted(() => vi.fn())

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

const fake = setupFakeApi(() => ({
  console: {
    init: {
      get: () => ({ status: 'not_started' }),
      post: () => ({ result: 'success' }),
    },
  },
}))

beforeEach(() => {
  replace.mockReset()
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
  expect(fake.console.init.post).not.toHaveBeenCalled()
})

it('reports an incorrect password on the field until it is edited', async () => {
  fake.console.init.post.mockRejectedValue(
    apiError({ status: 401, code: 'init_validate_failed', message: 'Invalid password' }),
  )
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
  fake.console.init.post.mockRejectedValue(
    apiError({ status: 500, code: 'internal_error', message: 'Internal error' }),
  )
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
  const screen = await renderPopup()

  await userEvent.fill(screen.getByLabelText('login.adminInitPassword'), 'correct')
  await userEvent.click(screen.getByRole('button', { name: 'login.validate' }))

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/install'))
  expect(replace).toHaveBeenCalledTimes(1)
})

it('sends an already validated instance to install', async () => {
  fake.console.init.get.mockResolvedValue({ status: 'finished' })

  await renderPopup()

  await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/install'))
  expect(fake.console.init.post).not.toHaveBeenCalled()
})
