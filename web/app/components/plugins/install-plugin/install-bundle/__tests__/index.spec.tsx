import type { Dependency, InstallStatusResponse, PluginDeclaration } from '../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithSystemFeatures as render } from '@/__tests__/utils/mock-system-features'
import { PluginCategoryEnum, TaskStatus } from '../../../types'
import InstallBundle from '../index'

const {
  mockCheckTaskStatus,
  mockEmit,
  mockInstalledInfo,
  mockInstallOrUpdate,
  mockInstallResults,
  mockRefreshPluginList,
} = vi.hoisted(() => ({
  mockCheckTaskStatus: vi.fn(),
  mockEmit: vi.fn(),
  mockInstalledInfo: {},
  mockInstallOrUpdate: vi.fn(),
  mockInstallResults: { value: [] as InstallStatusResponse[] },
  mockRefreshPluginList: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchPluginsInMarketPlaceByInfo: () => ({
    isLoading: false,
    data: { data: { list: [] } },
    error: null,
  }),
  useInstallOrUpdate: ({
    onSuccess,
  }: {
    onSuccess: (results: InstallStatusResponse[]) => Promise<void>
  }) => ({
    isPending: false,
    mutate: (payload: unknown) => {
      mockInstallOrUpdate(payload)
      void onSuccess(mockInstallResults.value)
    },
  }),
  usePluginTaskList: () => ({ handleRefetch: vi.fn() }),
  useUploadGitHub: () => ({ data: null, error: null }),
}))

vi.mock('../../hooks/use-check-installed', () => ({
  default: () => ({ installedInfo: mockInstalledInfo, isLoading: false }),
}))

vi.mock('../../hooks/use-install-plugin-limit', () => ({
  default: () => ({ canInstall: true, isLoading: false }),
  pluginInstallLimit: () => ({ canInstall: true }),
}))

vi.mock('../../base/check-task-status', () => ({
  default: () => ({ check: mockCheckTaskStatus, stop: vi.fn() }),
}))

vi.mock('../../hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  useCanInstallPluginFromMarketplace: () => ({ canInstallPluginFromMarketplace: true }),
}))

vi.mock('@/context/mitt-context', () => ({
  useMittContextSelector: () => mockEmit,
}))

function createManifest(name: string): PluginDeclaration {
  const slug = name.toLowerCase().replaceAll(' ', '-')
  return {
    plugin_unique_identifier: `acme/${slug}:1.0.0`,
    version: '1.0.0',
    author: 'acme',
    icon: 'icon.png',
    name,
    category: PluginCategoryEnum.tool,
    label: { 'en-US': name } as PluginDeclaration['label'],
    description: { 'en-US': `${name} description` } as PluginDeclaration['description'],
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
  }
}

function createDependency(name: string): Dependency {
  const manifest = createManifest(name)
  return {
    type: 'package',
    value: {
      unique_identifier: manifest.plugin_unique_identifier,
      manifest,
    },
  }
}

describe('InstallBundle', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockInstallResults.value = [
      {
        status: TaskStatus.success,
        taskId: 'task-1',
        uniqueIdentifier: 'acme/first-plugin:1.0.0',
      },
    ]
    mockCheckTaskStatus.mockResolvedValue({ status: TaskStatus.success })
  })

  it('names the dialog and exposes a close action for the dependency workflow', async () => {
    const user = userEvent.setup()
    render(<InstallBundle fromDSLPayload={[createDependency('First Plugin')]} onClose={onClose} />)

    expect(
      screen.getByRole('dialog', { name: 'plugin.installModal.installPlugin' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('installs only the dependencies the user keeps selected', async () => {
    const user = userEvent.setup()
    const firstDependency = createDependency('First Plugin')
    const secondDependency = createDependency('Second Plugin')
    render(<InstallBundle fromDSLPayload={[firstDependency, secondDependency]} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'First Plugin' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Second Plugin' })).toBeChecked()
    })
    await user.click(screen.getByRole('checkbox', { name: 'Second Plugin' }))
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).toBeInTheDocument()
    expect(mockInstallOrUpdate).toHaveBeenCalledWith({
      payload: [firstDependency],
      plugin: [expect.objectContaining({ name: 'First Plugin' })],
      installedInfo: {},
    })
    expect(mockRefreshPluginList).toHaveBeenCalledWith(undefined, true)
    expect(mockEmit).toHaveBeenCalledWith('plugin:install:success', [
      'acme/first-plugin:1.0.0/First Plugin',
    ])

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('reports a terminal failure when every selected dependency fails to install', async () => {
    const user = userEvent.setup()
    mockInstallResults.value = [
      {
        status: TaskStatus.failed,
        taskId: 'task-1',
        uniqueIdentifier: 'acme/first-plugin:1.0.0',
      },
    ]
    render(<InstallBundle fromDSLPayload={[createDependency('First Plugin')]} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'First Plugin' })).toBeChecked()
    })
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installFailed' }),
    ).toBeInTheDocument()
    expect(screen.getByText('plugin.installModal.installFailedDesc')).toBeInTheDocument()
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('reports mixed results and emits only the successfully installed dependency', async () => {
    const user = userEvent.setup()
    mockInstallResults.value = [
      {
        status: TaskStatus.success,
        taskId: 'task-1',
        uniqueIdentifier: 'acme/first-plugin:1.0.0',
      },
      {
        status: TaskStatus.failed,
        taskId: 'task-2',
        uniqueIdentifier: 'acme/second-plugin:1.0.0',
      },
    ]
    render(
      <InstallBundle
        fromDSLPayload={[createDependency('First Plugin'), createDependency('Second Plugin')]}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'First Plugin' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Second Plugin' })).toBeChecked()
    })
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('plugin.installModal.installedSuccessfullyCountDesc:{"num":1}'),
    ).toBeInTheDocument()
    expect(screen.getByTitle('Second Plugin')).toBeInTheDocument()
    expect(mockRefreshPluginList).toHaveBeenCalledWith(undefined, true)
    expect(mockEmit).toHaveBeenCalledWith('plugin:install:success', [
      'acme/first-plugin:1.0.0/First Plugin',
    ])
  })

  it('emits only dependencies whose polled task succeeds', async () => {
    const user = userEvent.setup()
    mockInstallResults.value = [
      {
        status: TaskStatus.running,
        taskId: 'task-1',
        uniqueIdentifier: 'acme/first-plugin:1.0.0',
      },
      {
        status: TaskStatus.failed,
        taskId: 'task-2',
        uniqueIdentifier: 'acme/second-plugin:1.0.0',
      },
    ]
    mockCheckTaskStatus.mockResolvedValue({ status: TaskStatus.success })
    render(
      <InstallBundle
        fromDSLPayload={[createDependency('First Plugin'), createDependency('Second Plugin')]}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: 'First Plugin' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Second Plugin' })).toBeChecked()
    })
    await user.click(screen.getByRole('button', { name: 'plugin.installModal.install' }))

    expect(
      await screen.findByRole('dialog', { name: 'plugin.installModal.installedSuccessfully' }),
    ).toBeInTheDocument()
    expect(mockEmit).toHaveBeenCalledWith('plugin:install:success', [
      'acme/first-plugin:1.0.0/First Plugin',
    ])
  })
})
