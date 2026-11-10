import type { PluginInstallTaskStartResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { API_PREFIX } from '@/config'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { PermissionType, TaskStatus } from '../../../types'
import InstallFromLocalPackage from '../index'

const { upload, install, installedPlugins, uninstall, pollTask, refresh } = vi.hoisted(() => ({
  upload: vi.fn(),
  install: vi.fn(),
  installedPlugins: vi.fn(),
  uninstall: vi.fn(),
  pollTask: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadFile: upload,
  uninstallPlugin: uninstall,
  checkTaskStatus: pollTask,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.permission.fetch.get': async () => ({
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      }),
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.install.pkg.post': install,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': installedPlugins,
    }),
  }
})
// Refreshing the separate model/tool catalogs is covered by use-refresh-plugin-list.
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: refresh }),
}))

const manifest = createPluginDeclarationFixture({
  author: 'test',
  name: 'local',
  label: { ...createPluginDeclarationFixture().label, en_US: 'Local plugin' },
})
const uploadedPackage = { unique_identifier: 'test/local:1.0.0', manifest }
const file = new File(['package'], 'local.difypkg', { type: 'application/octet-stream' })
const renderInstaller = (selectedFile = file, options: ConsoleQueryTestOptions = {}) => {
  const onClose = vi.fn()
  renderWithConsoleQuery(
    <InstallFromLocalPackage file={selectedFile} onClose={onClose} onSuccess={vi.fn()} />,
    {
      accountProfileMeta: { currentVersion: '1.0.0' },
      currentWorkspace: { id: 'local-install-workspace' },
      workspacePermissionKeys: ['plugin.install'],
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: true,
        plugin_installation_permission: {
          plugin_installation_scope: 'all',
          restrict_to_marketplace_only: false,
        },
      },
      ...options,
    },
  )
  return { onClose }
}
const installButton = () => screen.getByRole('button', { name: 'plugin.installModal.install' })
const startInstall = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByText('plugin.installModal.readyToInstall')
  await waitFor(() => expect(installButton()).toBeEnabled())
  await user.click(installButton())
}

beforeEach(() => {
  vi.resetAllMocks()
  upload.mockResolvedValue(uploadedPackage)
  installedPlugins.mockResolvedValue({ plugins: [] })
  install.mockResolvedValue({ all_installed: true, task_id: '' })
  uninstall.mockResolvedValue({})
})

it('uploads the file, prevents duplicate installs while pending, and shows the completed package', async () => {
  const user = userEvent.setup()
  const uploaded = createDeferred<typeof uploadedPackage>()
  const started = createDeferred<PluginInstallTaskStartResponse>()
  upload.mockReturnValue(uploaded.promise)
  install.mockReturnValue(started.promise)
  const { onClose } = renderInstaller()
  expect(screen.getByText(/plugin.installModal.uploadingPackage/)).toHaveTextContent(
    'local.difypkg',
  )
  expect(installButton()).toBeDisabled()
  expect(upload).toHaveBeenCalledExactlyOnceWith(file, false)
  uploaded.resolve(uploadedPackage)
  await startInstall(user)
  expect(screen.queryByText(/plugin.installModal.uploadingPackage/)).not.toBeInTheDocument()
  const pendingButton = screen.getByRole('button', { name: 'plugin.installModal.installing' })
  expect(pendingButton).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'common.operation.cancel' })).not.toBeInTheDocument()
  await user.click(pendingButton)
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/local:1.0.0'] },
  })
  started.resolve({ all_installed: true, task_id: '' })
  await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
  expect(screen.getByText('Local plugin')).toBeInTheDocument()
  expect(screen.getByText('1.0.0')).toBeInTheDocument()
  expect(refresh).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      name: 'local',
      icon: `${API_PREFIX}/workspaces/current/plugin/icon?tenant_id=local-install-workspace&filename=test-icon.png`,
    }),
  )
  expect(pollTask).not.toHaveBeenCalled()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
  expect(onClose).toHaveBeenCalledOnce()
})

it.each(['common.operation.cancel', 'common.operation.close'])(
  'allows %s while upload is pending without installing',
  async (name) => {
    const user = userEvent.setup()
    upload.mockReturnValue(new Promise(() => {}))
    const { onClose } = renderInstaller()
    await user.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(install).not.toHaveBeenCalled()
  },
)

it.each([
  {
    reason: 'server error',
    error: createHttpError(new Response(null, { status: 413 }), { message: 'File too large' }),
    message: 'File too large',
  },
  {
    reason: 'transport error',
    error: new TypeError('Failed to fetch'),
    message: 'plugin.installModal.uploadFailed',
  },
])('shows $reason from upload and allows closing the failure', async ({ error, message }) => {
  const user = userEvent.setup()
  upload.mockRejectedValue(error)
  const { onClose } = renderInstaller()
  await screen.findByRole('dialog', { name: 'plugin.installModal.uploadFailed' })
  expect(screen.getAllByText(message).length).toBeGreaterThan(0)
  expect(
    screen.queryByRole('button', { name: 'plugin.installModal.install' }),
  ).not.toBeInTheDocument()
  expect(install).not.toHaveBeenCalled()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
  expect(onClose).toHaveBeenCalledOnce()
})

it.each(['local.difypkg', 'local.difybndl'])(
  'rejects an invalid upload response for %s before installing',
  async (name) => {
    upload.mockResolvedValue({})
    renderInstaller(new File(['invalid'], name))
    await screen.findByRole('dialog', { name: 'plugin.installModal.uploadFailed' })
    expect(
      screen.queryByRole('button', { name: 'plugin.installModal.install' }),
    ).not.toBeInTheDocument()
    expect(install).not.toHaveBeenCalled()
  },
)

it('waits for installed-version lookup, then preserves credentials before replacing the package', async () => {
  const user = userEvent.setup()
  const previous = createPluginEntity({
    id: 'old-installation',
    plugin_id: 'test/local',
    plugin_unique_identifier: 'test/local:0.9.0',
  })
  previous.declaration.version = '0.9.0'
  const lookup = createDeferred<{ plugins: (typeof previous)[] }>()
  const removal = createDeferred<void>()
  installedPlugins.mockReturnValue(lookup.promise)
  uninstall.mockReturnValue(removal.promise)
  renderInstaller()
  await screen.findByText('plugin.installModal.readyToInstall')
  expect(installButton()).toBeDisabled()
  lookup.resolve({ plugins: [previous] })
  await screen.findByText('0.9.0 -> 1.0.0')
  await startInstall(user)
  expect(uninstall).toHaveBeenCalledExactlyOnceWith('old-installation', {
    preserveCredentials: true,
  })
  expect(install).not.toHaveBeenCalled()
  removal.resolve()
  await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/local:1.0.0'] },
  })
})

it('skips reinstalling an identical package', async () => {
  installedPlugins.mockResolvedValue({
    plugins: [
      createPluginEntity({ plugin_id: 'test/local', plugin_unique_identifier: 'test/local:1.0.0' }),
    ],
  })
  renderInstaller()
  await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
  expect(install).not.toHaveBeenCalled()
  expect(uninstall).not.toHaveBeenCalled()
})

it.each([TaskStatus.success, TaskStatus.failed])(
  'shows the asynchronous task result: %s',
  async (status) => {
    const user = userEvent.setup()
    const task = createDeferred<{
      task: { plugins: { plugin_unique_identifier: string; status: TaskStatus; message: string }[] }
    }>()
    install.mockResolvedValue({ all_installed: false, task_id: 'install-task' })
    pollTask.mockReturnValue(task.promise)
    renderInstaller()
    await startInstall(user)
    await waitFor(() => expect(pollTask).toHaveBeenCalledExactlyOnceWith('install-task'))
    expect(screen.getByRole('button', { name: 'plugin.installModal.installing' })).toBeDisabled()
    task.resolve({
      task: {
        plugins: [
          {
            plugin_unique_identifier: 'test/local:1.0.0',
            status,
            message: 'Dependency unavailable',
          },
        ],
      },
    })
    await screen.findByRole('dialog', {
      name:
        status === TaskStatus.success
          ? 'plugin.installModal.installedSuccessfully'
          : 'plugin.installModal.installFailed',
    })
    if (status === TaskStatus.failed)
      expect(screen.getByText('Dependency unavailable')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  },
)

it('shows a generic installation failure when the install request rejects', async () => {
  const user = userEvent.setup()
  install.mockRejectedValue(new Error('Connection failed'))
  renderInstaller()
  await startInstall(user)
  await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' })
  expect(screen.getByText('plugin.installModal.installFailedDesc')).toBeInTheDocument()
  expect(refresh).not.toHaveBeenCalled()
})

it('uploads a bundle and installs its returned package dependency', async () => {
  const user = userEvent.setup()
  const bundle = new File(['bundle'], 'local.difybndl')
  upload.mockResolvedValue(
    ['bundled'].map((name) => ({
      type: 'package',
      value: {
        unique_identifier: `test/${name}:1.0.0`,
        manifest: createPluginDeclarationFixture({ author: 'test', name }),
      },
    })),
  )
  renderInstaller(bundle)
  await waitFor(() => expect(installButton()).toBeEnabled())
  await user.click(installButton())
  await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' })
  expect(upload).toHaveBeenCalledExactlyOnceWith(bundle, true)
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: { plugin_unique_identifiers: ['test/bundled:1.0.0'] },
  })
  expect(
    screen.getByText('plugin.installModal.installedSuccessfullyCountDesc:{"num":1}'),
  ).toBeInTheDocument()
})

it.each([
  { currentVersion: '1.0.0', minimum: '0.8.0', warns: false },
  { currentVersion: '1.0.0', minimum: '2.0.0', warns: true },
  { currentVersion: '1.0.0', minimum: undefined, warns: false },
  { currentVersion: null, minimum: '2.0.0', warns: false },
])(
  'warns about compatibility for Dify $currentVersion and minimum $minimum without blocking installation',
  async ({ currentVersion, minimum, warns }) => {
    upload.mockResolvedValue({
      ...uploadedPackage,
      manifest: { ...manifest, meta: { version: '1.0.0', minimum_dify_version: minimum } },
    })
    renderInstaller(file, { accountProfileMeta: { currentVersion } })
    await screen.findByText('plugin.installModal.readyToInstall')
    await waitFor(() => expect(installButton()).toBeEnabled())
    if (warns)
      expect(screen.getByText(/plugin.difyVersionNotCompatible/)).toHaveTextContent('2.0.0')
    else expect(screen.queryByText(/plugin.difyVersionNotCompatible/)).not.toBeInTheDocument()
  },
)
