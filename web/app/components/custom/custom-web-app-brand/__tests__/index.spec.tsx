import type { WorkspaceCustomConfigPayload } from '@dify/contracts/api/console/workspaces/types.gen'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { AppToastHost } from '@/app/notifications/host'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import CustomWebAppBrand from '../index'

const upload = vi.hoisted(() => vi.fn<typeof import('@/service/base').upload>())
const updateConfig = vi.hoisted(() =>
  vi.fn<(input: { body: WorkspaceCustomConfigPayload }) => Promise<WorkspaceCustomConfigPayload>>(),
)
let config: WorkspaceCustomConfigPayload
const getConfig = vi.hoisted(() => vi.fn<() => Promise<WorkspaceCustomConfigPayload>>())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.customConfig.get': getConfig,
      'workspaces.customConfig.post': updateConfig,
    }),
  }
})
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  upload,
}))

const renderBrand = ({
  canReplace = true,
  canManage = true,
  seedConfig = true,
  workspaceLogo = '',
} = {}) => {
  const user = userEvent.setup()
  const queryClient = createConsoleQueryClient()
  if (seedConfig)
    queryClient.setQueryData(consoleQuery.workspaces.customConfig.get.queryKey(), config)
  const rendered = renderWithConsoleQuery(
    <>
      <CustomWebAppBrand />
      <AppToastHost timeout={0} />
    </>,
    {
      queryClient,
      features: { can_replace_logo: canReplace },
      currentWorkspace: { role: 'normal' },
      workspacePermissionKeys: canManage ? ['customization.manage'] : [],
      systemFeatures: { branding: { enabled: !!workspaceLogo, workspace_logo: workspaceLogo } },
    },
  )
  return { ...rendered, user }
}
const uploadInput = () => screen.getByLabelText('custom.webapp.changeLogo')
const removalSwitch = () => screen.getByRole('switch', { name: 'custom.webapp.removeBrand' })
const logoFile = () => new File(['logo'], 'logo.png', { type: 'image/png' })
const expectPreviewLogo = (url: string) => {
  const logos = screen.getAllByRole('img', { name: 'logo' })
  expect(logos).toHaveLength(2)
  for (const logo of logos) expect(logo).toHaveAttribute('src', expect.stringContaining(url))
}

beforeEach(() => {
  config = { replace_webapp_logo: 'https://example.com/logo.png', remove_webapp_brand: false }
  getConfig.mockReset().mockImplementation(async () => config)
  updateConfig.mockReset().mockImplementation(async ({ body }) => {
    config = { ...config, ...body }
    return config
  })
  upload.mockReset().mockResolvedValue({ id: 'new-logo' })
})
afterEach(() => toast.dismiss())

it('cancels an upload, accepts the same file again, then applies and restores the logo', async () => {
  const { user } = renderBrand()
  const file = logoFile()
  await user.upload(uploadInput(), file)
  await user.click(await screen.findByRole('button', { name: 'common.operation.cancel' }))
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  expect(updateConfig).not.toHaveBeenCalled()
  expectPreviewLogo('https://example.com/logo.png')
  await user.upload(uploadInput(), file)
  expect(upload).toHaveBeenCalledTimes(2)
  expect(upload).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: expect.any(FormData) }),
    false,
    '/workspaces/custom-config/webapp-logo/upload',
  )
  const uploadedFile = upload.mock.lastCall?.[0].data.get('file')
  expect(uploadedFile).toBeInstanceOf(File)
  expect(uploadedFile).toMatchObject({ name: file.name, size: file.size, type: file.type })
  await user.click(await screen.findByRole('button', { name: 'custom.apply' }))
  await waitFor(() => expectPreviewLogo('new-logo'))
  expect(updateConfig).toHaveBeenCalledExactlyOnceWith({
    body: { remove_webapp_brand: false, replace_webapp_logo: 'new-logo' },
  })
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'custom.restore' }))
  await waitFor(() => expect(screen.getAllByRole('img', { name: 'Dify' })).toHaveLength(2))
  expect(uploadInput()).toBeEnabled()
  expect(updateConfig).toHaveBeenLastCalledWith({
    body: { remove_webapp_brand: false, replace_webapp_logo: '' },
  })
  expect(screen.getAllByRole('img', { name: 'Dify' })).toHaveLength(2)
})

it('removes branding from both previews and restores it when switched back on', async () => {
  const { user } = renderBrand()
  expectPreviewLogo('https://example.com/logo.png')
  await user.click(screen.getByText('custom.webapp.removeBrand'))
  await waitFor(() => expect(removalSwitch()).toBeChecked())
  expect(updateConfig).toHaveBeenCalledExactlyOnceWith({ body: { remove_webapp_brand: true } })
  expect(screen.queryAllByText('POWERED BY')).toHaveLength(0)
  expect(screen.queryAllByRole('img', { name: 'logo' })).toHaveLength(0)
  expect(uploadInput()).toBeDisabled()
  await user.click(removalSwitch())
  await waitFor(() => expect(removalSwitch()).not.toBeChecked())
  expectPreviewLogo('https://example.com/logo.png')
  expect(uploadInput()).toBeEnabled()
})

it('prefers workspace branding over the custom web app logo in both previews', () => {
  renderBrand({ workspaceLogo: 'https://example.com/workspace.png' })
  expectPreviewLogo('https://example.com/workspace.png')
})

it.each([
  { reason: 'plan restriction', canReplace: false, canManage: true },
  { reason: 'missing permission', canReplace: true, canManage: false },
])('prevents changes with $reason', async ({ canReplace, canManage }) => {
  const { user } = renderBrand({ canReplace, canManage })
  await user.click(removalSwitch())
  await user.upload(uploadInput(), logoFile())
  expect(removalSwitch()).toHaveAttribute('aria-disabled', 'true')
  expect(uploadInput()).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'custom.restore' })).not.toBeInTheDocument()
  expect(updateConfig).not.toHaveBeenCalled()
  expect(upload).not.toHaveBeenCalled()
})

it('keeps edits disabled until the custom configuration arrives', async () => {
  const request = createDeferred<WorkspaceCustomConfigPayload>()
  getConfig.mockReturnValue(request.promise)
  renderBrand({ seedConfig: false })
  expect(removalSwitch()).toHaveAttribute('aria-disabled', 'true')
  expect(uploadInput()).toBeDisabled()
  await act(async () => request.resolve(config))
  await waitFor(() => expect(uploadInput()).toBeEnabled())
  expect(removalSwitch()).not.toHaveAttribute('aria-disabled', 'true')
  expectPreviewLogo('https://example.com/logo.png')
})

it('keeps edits disabled when loading configuration fails', async () => {
  getConfig.mockRejectedValue(new Error('Configuration unavailable'))
  const { user, queryClient } = renderBrand({ seedConfig: false })
  await waitFor(() =>
    expect(
      queryClient.getQueryState(consoleQuery.workspaces.customConfig.get.queryKey())?.status,
    ).toBe('error'),
  )
  expect(removalSwitch()).toHaveAttribute('aria-disabled', 'true')
  expect(uploadInput()).toBeDisabled()
  await user.click(removalSwitch())
  expect(updateConfig).not.toHaveBeenCalled()
})

it('rejects an oversized logo before sending an upload', async () => {
  const { user } = renderBrand()
  await user.upload(
    uploadInput(),
    new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
  )
  expect(
    await screen.findByText('common.imageUploader.uploadFromComputerLimit:{"size":5}'),
  ).toBeVisible()
  expect(upload).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
})

it('shows upload progress and waits for a successful upload before offering Apply', async () => {
  const request = createDeferred<Awaited<ReturnType<typeof upload>>>()
  upload.mockImplementation((options) => {
    options.onprogress?.call(
      options.xhr,
      new ProgressEvent('progress', { lengthComputable: true, loaded: 50, total: 100 }),
    )
    return request.promise
  })
  const { user } = renderBrand()
  await user.upload(uploadInput(), logoFile())
  expect(screen.getByRole('button', { name: 'custom.uploading' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  await act(async () => request.resolve({ id: 'new-logo' }))
  expect(await screen.findByRole('button', { name: 'custom.apply' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'custom.uploading' })).not.toBeInTheDocument()
})

it.each([
  {
    error: new ORPCError('forbidden', { message: 'Workspace upload denied' }),
    message: 'Workspace upload denied',
  },
  {
    error: new Error('Network unavailable'),
    message: 'common.imageUploader.uploadFromComputerUploadError',
  },
])('shows $message and allows retry after an upload failure', async ({ error, message }) => {
  upload.mockRejectedValueOnce(error)
  const { user } = renderBrand()
  const file = logoFile()
  await user.upload(uploadInput(), file)
  expect(await screen.findByText(message)).toBeVisible()
  expect(screen.getByText('custom.uploadedFail')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'custom.apply' })).not.toBeInTheDocument()
  expect(updateConfig).not.toHaveBeenCalled()
  await user.upload(uploadInput(), file)
  expect(await screen.findByRole('button', { name: 'custom.apply' })).toBeEnabled()
  expect(screen.queryByText('custom.uploadedFail')).not.toBeInTheDocument()
})
