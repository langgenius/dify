import { act, screen, waitFor } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { createDeferred } from '@/test/deferred'
import { credentials, dialogName, renderModelList } from './model-list-test-env'

// Isolate the cold module load from tests that exercise an already available dialog.
const moduleReady = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('../model-load-balancing-modal', async (importOriginal) => {
  await moduleReady()
  return importOriginal<typeof import('../model-load-balancing-modal')>()
})
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': async () =>
        credentials,
    }),
  }
})
afterEach(() => toast.dismiss())

it('reopens a dismissed loading dialog and shows the real editor when its module becomes available', async () => {
  const pending = createDeferred()
  moduleReady.mockReturnValue(pending.promise)
  const { user, onChange } = renderModelList()
  const configure = () => screen.getAllByRole('button', { name: 'common.operation.config' })[0]!
  await user.click(configure())
  expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
  )
  await user.click(configure())
  expect(await screen.findByRole('status')).toHaveAttribute('aria-busy', 'true')
  await act(async () => pending.resolve())
  expect(await screen.findByRole('button', { name: 'common.operation.save' })).toBeEnabled()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: dialogName })).not.toBeInTheDocument(),
  )
  expect(onChange).not.toHaveBeenCalled()
})
