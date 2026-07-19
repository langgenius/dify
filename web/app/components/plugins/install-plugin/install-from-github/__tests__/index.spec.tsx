import type {
  GitHubRepoReleaseResponse,
  PluginDeclaration,
  UpdateFromGitHubPayload,
} from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { PluginCategoryEnum } from '../../../types'
import InstallFromGitHub from '../index'

const {
  mockCheckTaskStatus,
  mockFetchReleases,
  mockHandleInstallTaskStart,
  mockHandleUpload,
  mockInstallPackageFromGitHub,
  mockRefreshPluginList,
  mockToastError,
  mockUpdateFromGitHub,
} = vi.hoisted(() => ({
  mockCheckTaskStatus: vi.fn(),
  mockFetchReleases: vi.fn(),
  mockHandleInstallTaskStart: vi.fn(),
  mockHandleUpload: vi.fn(),
  mockInstallPackageFromGitHub: vi.fn(),
  mockRefreshPluginList: vi.fn(),
  mockToastError: vi.fn(),
  mockUpdateFromGitHub: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { error: mockToastError },
}))

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks')>()
  return {
    ...actual,
    fetchReleases: mockFetchReleases,
    handleUpload: mockHandleUpload,
  }
})

vi.mock('@/service/plugins', () => ({
  updateFromGitHub: mockUpdateFromGitHub,
}))

vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromGitHub: () => ({ mutateAsync: mockInstallPackageFromGitHub }),
  usePluginTaskList: () => ({ handleInstallTaskStart: mockHandleInstallTaskStart }),
}))

vi.mock('../../hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: {}, isLoading: false }),
}))

vi.mock('../../base/check-task-status', () => ({
  default: () => ({ check: mockCheckTaskStatus, stop: vi.fn() }),
}))

vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

function createManifest(overrides: Partial<PluginDeclaration> = {}): PluginDeclaration {
  return {
    plugin_unique_identifier: 'acme/example:1.0.0',
    version: '1.0.0',
    author: 'acme',
    icon: 'icon.png',
    name: 'Example Plugin',
    category: PluginCategoryEnum.tool,
    label: { 'en-US': 'Example Plugin' } as PluginDeclaration['label'],
    description: { 'en-US': 'Example plugin description' } as PluginDeclaration['description'],
    created_at: '2026-01-01T00:00:00Z',
    resource: {},
    plugins: [],
    verified: true,
    endpoint: { settings: [], endpoints: [] },
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: {} as PluginDeclaration['trigger'],
    ...overrides,
  }
}

function createReleases(): GitHubRepoReleaseResponse[] {
  return [
    {
      tag_name: 'v1.0.0',
      assets: [
        {
          id: 1,
          name: 'example-plugin.difypkg',
          browser_download_url:
            'https://github.com/acme/example/releases/download/v1.0.0/example-plugin.difypkg',
        },
      ],
    },
  ]
}

function createUpdatePayload(): UpdateFromGitHubPayload {
  return {
    originalPackageInfo: {
      id: 'installed-package-1',
      repo: 'acme/example',
      version: 'v0.9.0',
      package: 'example-plugin.difypkg',
      releases: createReleases(),
    },
  }
}

async function reachPackageSelection(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
    'https://github.com/acme/example',
  )
  await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

  expect(
    await screen.findByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
  ).toBeInTheDocument()
}

async function reachReadyToInstall(user: ReturnType<typeof userEvent.setup>) {
  await reachPackageSelection(user)

  await user.click(screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }))
  await user.click(await screen.findByRole('option', { name: 'v1.0.0' }))
  await user.click(screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }))
  await user.click(await screen.findByRole('option', { name: 'example-plugin.difypkg' }))
  await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

  expect(await screen.findByRole('button', { name: 'plugin.installModal.install' })).toBeEnabled()
}

describe('InstallFromGitHub', () => {
  const onClose = vi.fn()
  const onSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchReleases.mockResolvedValue(createReleases())
    mockHandleUpload.mockImplementation(
      async (
        _repo: string,
        _version: string,
        _packageName: string,
        onUploaded?: (result: { manifest: PluginDeclaration; unique_identifier: string }) => void,
      ) => {
        const result = {
          manifest: createManifest(),
          unique_identifier: 'acme/example:1.0.0',
        }
        onUploaded?.(result)
        return result
      },
    )
    mockInstallPackageFromGitHub.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckTaskStatus.mockResolvedValue({ status: 'success' })
  })

  it('names the dialog and lets the user cancel before choosing a repository', async () => {
    const user = userEvent.setup()
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)

    expect(
      screen.getByRole('dialog', { name: 'plugin.installFromGitHub.installPlugin' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.installModal.next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.cancel' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('rejects a non-GitHub repository before requesting releases', async () => {
    const user = userEvent.setup()
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)

    await user.type(
      screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
      'https://example.com/acme/example',
    )
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

    expect(mockToastError).toHaveBeenCalledWith('plugin.error.inValidGitHubUrl')
    expect(mockFetchReleases).not.toHaveBeenCalled()
  })

  it('stays on the repository step when a valid repository has no releases', async () => {
    const user = userEvent.setup()
    mockFetchReleases.mockResolvedValueOnce([])
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)

    const repositoryInput = screen.getByRole('textbox', {
      name: 'plugin.installFromGitHub.gitHubRepo',
    })
    await user.type(repositoryInput, 'https://github.com/acme/empty')
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('plugin.error.noReleasesFound')
    })
    expect(repositoryInput).toHaveValue('https://github.com/acme/empty')
    expect(
      screen.queryByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
    ).not.toBeInTheDocument()
  })

  it('returns to the repository field without losing the entered URL', async () => {
    const user = userEvent.setup()
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)
    await reachPackageSelection(user)

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.back' }))

    expect(
      screen.getByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
    ).toHaveValue('https://github.com/acme/example')
  })

  it('installs a selected release and shows the terminal success state', async () => {
    const user = userEvent.setup()
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)
    await reachReadyToInstall(user)

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', {
        name: 'plugin.installFromGitHub.installedSuccessfully',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.installModal.installedSuccessfullyDesc')).toBeInTheDocument()
    expect(mockInstallPackageFromGitHub).toHaveBeenCalledWith({
      repoUrl: 'acme/example',
      selectedVersion: 'v1.0.0',
      selectedPackage: 'example-plugin.difypkg',
      uniqueIdentifier: 'acme/example:1.0.0',
    })
    expect(mockRefreshPluginList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Example Plugin',
        category: PluginCategoryEnum.tool,
      }),
    )
    expect(onSuccess).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('updates an installed package through the GitHub update entry flow', async () => {
    const user = userEvent.setup()
    mockUpdateFromGitHub.mockResolvedValue({
      all_installed: true,
      task_id: 'task-update-1',
    })
    render(
      <InstallFromGitHub
        updatePayload={createUpdatePayload()}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    )

    expect(
      screen.getByRole('dialog', { name: 'plugin.installFromGitHub.updatePlugin' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'plugin.installFromGitHub.gitHubRepo' }),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
    )
    await user.click(await screen.findByRole('option', { name: 'v1.0.0' }))
    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }),
    )
    await user.click(await screen.findByRole('option', { name: 'example-plugin.difypkg' }))
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))
    await user.click(await screen.findByRole('button', { name: 'plugin.installModal.install' }))

    expect(mockUpdateFromGitHub).toHaveBeenCalledWith(
      'acme/example',
      'v1.0.0',
      'example-plugin.difypkg',
      'installed-package-1',
      'acme/example:1.0.0',
    )
    expect(mockInstallPackageFromGitHub).not.toHaveBeenCalled()
    expect(
      await screen.findByRole('dialog', {
        name: 'plugin.installFromGitHub.installedSuccessfully',
      }),
    ).toBeInTheDocument()
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('shows the upload error returned by the package service', async () => {
    const user = userEvent.setup()
    mockHandleUpload.mockRejectedValue({ response: { message: 'Package signature is invalid' } })
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)

    await reachPackageSelection(user)
    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectVersion' }),
    )
    await user.click(await screen.findByRole('option', { name: 'v1.0.0' }))
    await user.click(
      screen.getByRole('combobox', { name: 'plugin.installFromGitHub.selectPackage' }),
    )
    await user.click(await screen.findByRole('option', { name: 'example-plugin.difypkg' }))
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.next' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.uploadFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Package signature is invalid')).toBeInTheDocument()
    expect(mockInstallPackageFromGitHub).not.toHaveBeenCalled()
  })

  it('shows the install failure and keeps the service error visible', async () => {
    const user = userEvent.setup()
    mockInstallPackageFromGitHub.mockRejectedValue('Installation was rejected')
    render(<InstallFromGitHub onClose={onClose} onSuccess={onSuccess} />)
    await reachReadyToInstall(user)

    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installFromGitHub.installFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Installation was rejected')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
  })
})
