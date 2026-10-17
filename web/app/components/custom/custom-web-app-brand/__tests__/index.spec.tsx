import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { imageUpload } from '@/app/components/base/image-uploader/utils'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import CustomWebAppBrand from '../index'

const updateConfig = vi.hoisted(() => vi.fn())
let config = { replace_webapp_logo: 'https://example.com/logo.png', remove_webapp_brand: false }
let configPending = false
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.customConfig.get': async () =>
        configPending ? new Promise<never>(() => {}) : config,
      'workspaces.customConfig.post': updateConfig,
    }),
  }
})
vi.mock('@/app/components/base/image-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/image-uploader/utils')>()),
  imageUpload: vi.fn(),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const renderBrand = ({ canReplace = true, canManage = true } = {}) => {
  const queryClient = createConsoleQueryClient()
  if (!configPending)
    queryClient.setQueryData(consoleQuery.workspaces.customConfig.get.queryKey(), config)
  return renderWithConsoleQuery(<CustomWebAppBrand />, {
    queryClient,
    features: { can_replace_logo: canReplace },
    workspacePermissionKeys: canManage ? ['customization.manage'] : [],
  })
}
const uploadInput = () =>
  screen
    .getByRole('button', { name: 'custom.change' })
    .querySelector('input[type="file"]') as HTMLInputElement

beforeEach(() => {
  config = { replace_webapp_logo: 'https://example.com/logo.png', remove_webapp_brand: false }
  configPending = false
  updateConfig.mockImplementation(async ({ body }) => {
    config = { ...config, ...body }
    return config
  })
  vi.mocked(imageUpload).mockImplementation(({ onSuccessCallback }) =>
    onSuccessCallback({ id: 'new-logo' }),
  )
})

it('cancels an upload, accepts the same file again, then applies and restores the logo', async () => {
  const user = userEvent.setup()
  renderBrand()
  const file = new File(['logo'], 'logo.png', { type: 'image/png' })
  await user.upload(uploadInput(), file)
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  expect(updateConfig).not.toHaveBeenCalled()
  await user.upload(uploadInput(), file)
  expect(imageUpload).toHaveBeenCalledTimes(2)
  await user.click(screen.getByRole('button', { name: 'custom.apply' }))
  await waitFor(() =>
    expect(updateConfig).toHaveBeenCalledWith({
      body: { remove_webapp_brand: false, replace_webapp_logo: 'new-logo' },
    }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument(),
  )
  await user.click(screen.getByRole('button', { name: 'custom.restore' }))
  await waitFor(() =>
    expect(updateConfig).toHaveBeenLastCalledWith({
      body: { remove_webapp_brand: false, replace_webapp_logo: '' },
    }),
  )
  expect(await screen.findByRole('button', { name: 'custom.upload' })).toBeEnabled()
})

it('persists brand removal and disables logo uploads after the refreshed config arrives', async () => {
  const user = userEvent.setup()
  renderBrand()
  await user.click(screen.getByRole('switch'))
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked())
  expect(updateConfig).toHaveBeenCalledExactlyOnceWith({ body: { remove_webapp_brand: true } })
  expect(screen.getByRole('button', { name: 'custom.change' })).toBeDisabled()
})

it.each([
  { reason: 'sandbox restriction', canReplace: false, canManage: true, pending: false },
  { reason: 'missing permission', canReplace: true, canManage: false, pending: false },
  { reason: 'unavailable config', canReplace: true, canManage: true, pending: true },
])('prevents changes with $reason', async ({ canReplace, canManage, pending }) => {
  const user = userEvent.setup()
  configPending = pending
  renderBrand({ canReplace, canManage })
  await user.click(screen.getByRole('switch'))
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  expect(
    screen.getByRole('button', { name: pending ? 'custom.upload' : 'custom.change' }),
  ).toBeDisabled()
  expect(updateConfig).not.toHaveBeenCalled()
  expect(imageUpload).not.toHaveBeenCalled()
})

it('shows upload failure without offering to apply an unuploaded file', async () => {
  const user = userEvent.setup()
  vi.mocked(imageUpload).mockImplementation(({ onErrorCallback }) =>
    onErrorCallback(new Error('Upload failed')),
  )
  renderBrand()
  await user.upload(uploadInput(), new File(['logo'], 'logo.png', { type: 'image/png' }))
  expect(screen.getByText('custom.uploadedFail')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  expect(updateConfig).not.toHaveBeenCalled()
})
