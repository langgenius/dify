import type { ComponentProps } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createHttpError } from '@/service/http-error'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createPluginDeclarationFixture, createPluginEntity } from '@/test/fixtures/plugin'
import { TaskStatus } from '../../../types'
import InstallFromGitHub from '../index'

const { fetchReleases, upload, install, pollTask, refresh, notify, installed, upgrade } =
  vi.hoisted(() => ({
    installed: vi.fn(),
    upgrade: vi.fn(),
    fetchReleases: vi.fn(),
    upload: vi.fn(),
    install: vi.fn(),
    pollTask: vi.fn(),
    refresh: vi.fn(),
    notify: vi.fn(),
  }))
vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  uploadGitHub: upload,
  updateFromGitHub: upgrade,
  checkTaskStatus: pollTask,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': installed,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.tasks.get': async () => ({ tasks: [] }),
      'workspaces.current.plugin.install.github.post': install,
    }),
  }
})
// Refreshing the separate model/tool catalogs is covered by use-refresh-plugin-list.
vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: refresh }),
}))
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return { ...actual, toast: Object.assign(vi.fn(), actual.toast, { error: notify }) }
})

const manifest = createPluginDeclarationFixture({ name: 'github' })
const uploadedPackage = { unique_identifier: 'test/github:1.0.0', manifest }
const releases = [
  {
    tag: 'v1.0.0',
    assets: [
      { downloadUrl: 'https://github.com/owner/repo/releases/download/v1.0.0/plugin.difypkg' },
    ],
  },
  {
    tag: 'v0.9.0',
    assets: [{ downloadUrl: 'https://github.com/owner/repo/releases/download/v0.9.0/old.difypkg' }],
  },
]
const renderInstaller = (props: Partial<ComponentProps<typeof InstallFromGitHub>> = {}) => {
  const onSuccess = vi.fn()
  const onClose = vi.fn()
  renderWithConsoleQuery(<InstallFromGitHub onSuccess={onSuccess} onClose={onClose} {...props} />)
  return { onSuccess, onClose }
}
const nextButton = () => screen.getByRole('button', { name: 'plugin.installModal.next' })
const versionSelect = () =>
  screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' })
const packageSelect = () =>
  screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' })
const submitRepo = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(
    screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
    'https://github.com/owner/repo',
  )
  await user.keyboard('{Enter}')
  await screen.findByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' })
}
const selectPackage = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(versionSelect())
  await user.click(await screen.findByRole('option', { name: 'v1.0.0' }))
  await user.click(packageSelect())
  await user.click(await screen.findByRole('option', { name: 'plugin.difypkg' }))
}
const loadPackage = async (user: ReturnType<typeof userEvent.setup>) => {
  await submitRepo(user)
  await selectPackage(user)
  await user.click(nextButton())
  return await screen.findByRole('button', { name: 'plugin.installModal.install' })
}

beforeEach(() => {
  vi.resetAllMocks()
  installed.mockResolvedValue({ plugins: [] })
  upgrade.mockResolvedValue({ all_installed: true, task_id: '' })
  vi.stubGlobal('fetch', fetchReleases)
  fetchReleases.mockImplementation(async () => Response.json({ releases }))
  upload.mockResolvedValue(uploadedPackage)
  install.mockResolvedValue({ all_installed: true, task_id: '' })
})
afterEach(() => vi.unstubAllGlobals())

it('submits the URL with Enter, installs the selected release, and waits for asynchronous completion handling', async () => {
  const user = userEvent.setup()
  const success = createDeferred<void>()
  const onSuccess = vi.fn(() => success.promise)
  const { onClose } = renderInstaller({ onSuccess })
  const input = screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' })
  await waitFor(() => expect(input).toHaveFocus())
  expect(nextButton()).toBeDisabled()
  const button = await loadPackage(user)
  expect(fetchReleases).toHaveBeenCalledExactlyOnceWith('https://ungh.cc/repos/owner/repo/releases')
  expect(upload).toHaveBeenCalledExactlyOnceWith('owner/repo', 'v1.0.0', 'plugin.difypkg')
  await user.click(button)
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  const pendingButton = screen.getByRole('button', { name: 'plugin.installModal.installing' })
  await user.click(pendingButton)
  expect(install).toHaveBeenCalledExactlyOnceWith({
    body: {
      repo: 'owner/repo',
      version: 'v1.0.0',
      package: 'plugin.difypkg',
      plugin_unique_identifier: 'test/github:1.0.0',
    },
  })
  expect(
    screen.queryByRole('dialog', { name: 'plugin.installFromGitHub.installedSuccessfully' }),
  ).not.toBeInTheDocument()
  success.resolve()
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installedSuccessfully' })
  expect(screen.getByText('Test Plugin')).toBeInTheDocument()
  expect(screen.queryByText('plugin.installFromGitHub.installNote')).not.toBeInTheDocument()
  expect(refresh).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      name: 'github',
      icon: expect.stringContaining('filename=test-icon.png'),
    }),
  )
  await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
  expect(onClose).toHaveBeenCalledOnce()
})

it('keeps URL and selections when navigating back through the real steps', async () => {
  const user = userEvent.setup()
  renderInstaller()
  await loadPackage(user)
  await user.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))
  expect(versionSelect()).toHaveTextContent('v1.0.0')
  expect(packageSelect()).toHaveTextContent('plugin.difypkg')
  await user.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))
  expect(screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' })).toHaveValue(
    'https://github.com/owner/repo',
  )
  expect(install).not.toHaveBeenCalled()
})

it('derives the package options from the selected release and blocks upload before selection', async () => {
  const user = userEvent.setup()
  renderInstaller()
  await submitRepo(user)
  expect(packageSelect()).toBeDisabled()
  expect(nextButton()).toBeDisabled()
  await user.click(versionSelect())
  await user.click(await screen.findByRole('option', { name: 'v0.9.0' }))
  await user.click(packageSelect())
  expect(await screen.findByRole('option', { name: 'old.difypkg' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'plugin.difypkg' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(nextButton()).toBeDisabled()
  expect(upload).not.toHaveBeenCalled()
})

it('blocks a release without assets from proceeding to upload', async () => {
  const user = userEvent.setup()
  fetchReleases.mockImplementation(async () =>
    Response.json({ releases: [{ tag: 'v1.0.0', assets: [] }] }),
  )
  renderInstaller()
  await submitRepo(user)
  await user.click(versionSelect())
  await user.click(await screen.findByRole('option', { name: 'v1.0.0' }))
  await user.click(packageSelect())
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(nextButton()).toBeDisabled()
  expect(upload).not.toHaveBeenCalled()
})

it('rejects an invalid URL before fetching releases', async () => {
  const user = userEvent.setup()
  renderInstaller()
  await user.type(
    screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
    'invalid-url',
  )
  await user.click(nextButton())
  expect(notify).toHaveBeenCalledWith('plugin.error.inValidGitHubUrl')
  expect(fetchReleases).not.toHaveBeenCalled()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it.each(['empty', 'error'])(
  'allows retrying release lookup after an %s response',
  async (response) => {
    const user = userEvent.setup()
    if (response === 'empty') fetchReleases.mockResolvedValueOnce(Response.json({ releases: [] }))
    else fetchReleases.mockRejectedValueOnce(new Error('Release service unavailable'))
    renderInstaller()
    await user.type(
      screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
      'https://github.com/owner/repo',
    )
    await user.click(nextButton())
    await waitFor(() => expect(notify).toHaveBeenCalledWith('plugin.error.noReleasesFound'))
    if (response === 'error') expect(notify).toHaveBeenCalledWith('Release service unavailable')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(nextButton())
    await screen.findByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' })
    expect(fetchReleases).toHaveBeenCalledTimes(2)
  },
)

it.each([
  [new Error('Package download failed'), 'Package download failed'],
  [
    createHttpError(new Response(null, { status: 500 }), { message: 'Package rejected' }),
    'Package rejected',
  ],
  ['Unexpected server response', 'plugin.installFromGitHub.uploadFailed'],
])('shows upload failure %s without starting installation', async (error, message) => {
  const user = userEvent.setup()
  upload.mockRejectedValue(error)
  const { onSuccess, onClose } = renderInstaller()
  await submitRepo(user)
  await selectPackage(user)
  await user.click(nextButton())
  await screen.findByText(message)
  expect(notify).toHaveBeenCalledWith('Error uploading package')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(install).not.toHaveBeenCalled()
  expect(onSuccess).not.toHaveBeenCalled()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.close' }).at(-1)!)
  expect(onClose).toHaveBeenCalledOnce()
})

it.each([TaskStatus.success, TaskStatus.failed])(
  'shows the asynchronous install result: %s',
  async (status) => {
    const user = userEvent.setup()
    install.mockResolvedValue({ all_installed: false, task_id: 'github-task' })
    pollTask.mockResolvedValue({
      task: {
        plugins: [
          {
            plugin_unique_identifier: 'test/github:1.0.0',
            status,
            message: 'Plugin initialization failed',
          },
        ],
      },
    })
    const { onSuccess } = renderInstaller()
    await user.click(await loadPackage(user))
    await screen.findByRole('dialog', {
      name:
        status === TaskStatus.success
          ? 'plugin.installFromGitHub.installedSuccessfully'
          : 'plugin.installFromGitHub.installFailed',
    })
    expect(pollTask).toHaveBeenCalledExactlyOnceWith('github-task')
    if (status === TaskStatus.failed) {
      expect(screen.getByText('Plugin initialization failed')).toBeInTheDocument()
      expect(onSuccess).not.toHaveBeenCalled()
    } else expect(onSuccess).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
  },
)

it.each([
  [new Error('Connection failed'), 'plugin.installModal.installFailedDesc'],
  ['Server install error', 'Server install error'],
])('shows the install failure for %s', async (error, message) => {
  const user = userEvent.setup()
  install.mockRejectedValue(error)
  const { onSuccess } = renderInstaller()
  await user.click(await loadPackage(user))
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installFailed' })
  expect(screen.getByText(message)).toBeInTheDocument()
  expect(onSuccess).not.toHaveBeenCalled()
})

it.each(['plugin.installModal.cancel', 'common.operation.close'])(
  'allows %s before selecting a repository',
  async (name) => {
    const user = userEvent.setup()
    const { onClose } = renderInstaller()
    await user.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(fetchReleases).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  },
)

it('blocks repeated upload and backward navigation until the selected package finishes loading', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<typeof uploadedPackage>()
  upload.mockReturnValueOnce(pending.promise)
  renderInstaller()
  await submitRepo(user)
  await selectPackage(user)
  const next = nextButton()
  await user.click(next)
  expect(next).toBeDisabled()
  const back = screen.getByRole('button', { name: 'plugin.installModal.back' })
  expect(back).toBeDisabled()
  await user.click(next)
  await user.click(back)
  expect(upload).toHaveBeenCalledExactlyOnceWith('owner/repo', 'v1.0.0', 'plugin.difypkg')
  expect(
    screen.queryByRole('button', { name: 'plugin.installModal.install' }),
  ).not.toBeInTheDocument()
  pending.resolve(uploadedPackage)
  expect(
    await screen.findByRole('button', { name: 'plugin.installModal.install' }),
  ).toBeInTheDocument()
  expect(install).not.toHaveBeenCalled()
})

it('waits for the installed version before upgrading the package selected from GitHub', async () => {
  const user = userEvent.setup()
  const existing = createPluginEntity({
    plugin_id: 'test/github',
    plugin_unique_identifier: 'test/github:0.9.0',
  })
  existing.declaration.version = '0.9.0'
  const lookup = createDeferred<{ plugins: ReturnType<typeof createPluginEntity>[] }>()
  installed.mockReturnValueOnce(lookup.promise)
  upload.mockResolvedValueOnce({
    ...uploadedPackage,
    manifest: { ...manifest, plugin_id: 'test/github' },
  })
  const { onSuccess } = renderInstaller()
  const button = await loadPackage(user)
  expect(button).toBeDisabled()
  await user.click(button)
  expect(install).not.toHaveBeenCalled()
  expect(upgrade).not.toHaveBeenCalled()
  await act(async () => lookup.resolve({ plugins: [existing] }))
  await waitFor(() => expect(button).toBeEnabled())
  expect(screen.getByText('0.9.0 -> 1.0.0')).toBeInTheDocument()
  expect(onSuccess).not.toHaveBeenCalled()
  await user.click(button)
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installedSuccessfully' })
  expect(upgrade).toHaveBeenCalledExactlyOnceWith(
    'owner/repo',
    'v1.0.0',
    'plugin.difypkg',
    'test/github:0.9.0',
    'test/github:1.0.0',
  )
  expect(onSuccess).toHaveBeenCalledOnce()
  expect(install).not.toHaveBeenCalled()
})

it('finishes without an install or upgrade when the selected GitHub package is already installed', async () => {
  const user = userEvent.setup()
  installed.mockResolvedValueOnce({
    plugins: [
      createPluginEntity({
        plugin_id: 'test/github',
        plugin_unique_identifier: uploadedPackage.unique_identifier,
      }),
    ],
  })
  upload.mockResolvedValueOnce({
    ...uploadedPackage,
    manifest: { ...manifest, plugin_id: 'test/github' },
  })
  const { onSuccess } = renderInstaller()
  await submitRepo(user)
  await selectPackage(user)
  await user.click(nextButton())
  await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installedSuccessfully' })
  expect(onSuccess).toHaveBeenCalledOnce()
  expect(upgrade).not.toHaveBeenCalled()
  expect(install).not.toHaveBeenCalled()
})
