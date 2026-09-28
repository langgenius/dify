import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import type { ReactElement } from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile as renderAccountProfile } from '@/test/console/account-profile'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { AgentPreviewVersionsPanel } from '../versions-panel'

const exportState = vi.hoisted(() => ({
  canExport: true,
  canRestore: true,
  restoreVersion: vi.fn(async (_input: unknown) => ({ result: 'success' })),
  isExporting: false,
  edition: 'CLOUD',
  plan: 'professional' as string | undefined,
  exportAppDsl: vi.fn(),
  onUrlUpdate: vi.fn(),
}))

vi.mock('@/features/agent-v2/permissions', () => ({
  useAgentPermissions: () => ({
    canImportExportDSL: exportState.canExport,
    canReleaseAndVersion: exportState.canRestore,
    agentQuery: { data: { app_id: 'app-1', name: 'My agent' } },
  }),
}))

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({
    exportAppDsl: exportState.exportAppDsl,
    isExporting: exportState.isExporting,
  }),
}))

vi.mock('jotai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jotai')>()),
  useAtomValue: () => exportState.edition,
}))

function render(ui: ReactElement, options?: Parameters<typeof renderAccountProfile>[1]) {
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper({ onUrlUpdate: exportState.onUrlUpdate })
  return renderAccountProfile(<NuqsWrapper>{ui}</NuqsWrapper>, options)
}

const versions: AgentConfigSnapshotSummaryResponse[] = [
  {
    id: 'version-2',
    version: 2,
    version_note: 'Published update',
    created_at: 1710000100,
    created_by: 'Alice',
  },
  {
    id: 'version-1',
    version: 1,
    version_note: null,
    created_at: 1710000000,
    created_by: 'Bob',
  },
  {
    id: 'version-0',
    version: 0,
    version_note: 'Initial release',
    created_at: 1709999900,
    created_by: 'user-1',
  },
]

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()

  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) =>
      options.queryKey[0] === 'features'
        ? { data: exportState.plan }
        : { data: { data: versions }, isPending: false },
  }
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: async () => ({ deployment_edition: 'CLOUD' }),
  }),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    features: { get: { queryOptions: () => ({ queryKey: ['features'] }) } },
    account: {
      profile: {
        get: {
          queryKey: () => [['console', 'account', 'profile', 'get'], { type: 'query' }],
        },
      },
    },
    agent: {
      byAgentId: {
        get: { queryKey: () => ['agent'] },
        composer: { get: { queryKey: () => ['composer'] } },
        versions: {
          byVersionId: {
            restore: {
              post: {
                mutationOptions: (options: Record<string, unknown>) => ({
                  ...options,
                  mutationFn: exportState.restoreVersion,
                }),
              },
            },
          },
          get: {
            queryOptions: () => ({ queryKey: ['agent-versions'] }),
            key: () => ['agent-versions'],
          },
        },
      },
    },
  },
}))

describe('AgentPreviewVersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    exportState.canExport = true
    exportState.canRestore = true
    exportState.restoreVersion.mockResolvedValue({ result: 'success' })
    exportState.isExporting = false
    exportState.edition = 'CLOUD'
    exportState.plan = 'professional'
  })

  describe('Version export', () => {
    const renderPanel = () => {
      const onSelectVersion = vi.fn()
      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={onSelectVersion}
          onClose={vi.fn()}
        />,
      )
      return onSelectVersion
    }

    it('exports the version whose menu was opened without changing the selected version', async () => {
      const user = userEvent.setup()
      const onSelectVersion = renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      await user.click(screen.getByRole('menuitem', { name: /export/i }))
      expect(exportState.exportAppDsl).toHaveBeenCalledWith({
        appId: 'app-1',
        appName: 'My agent',
        versionId: 'version-0',
      })
      expect(onSelectVersion).not.toHaveBeenCalled()
    })

    it('hides version actions without export or restore permission', () => {
      exportState.canExport = false
      exportState.canRestore = false
      renderPanel()
      expect(screen.queryByRole('button', { name: /moreActions/ })).not.toBeInTheDocument()
    })

    it('opens pricing instead of exporting on the Cloud sandbox plan', async () => {
      exportState.plan = 'sandbox'
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      await user.click(screen.getByRole('menuitem', { name: /export/i }))
      expect(exportState.onUrlUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ queryString: '?pricing=open' }),
      )
      expect(exportState.exportAppDsl).not.toHaveBeenCalled()
    })

    it.each(['COMMUNITY', 'ENTERPRISE'])(
      'allows export on %s without a Cloud plan',
      async (edition) => {
        exportState.edition = edition
        exportState.plan = undefined
        const user = userEvent.setup()
        renderPanel()
        await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
        await user.click(screen.getByRole('menuitem', { name: /export/i }))
        expect(exportState.exportAppDsl).toHaveBeenCalledWith(
          expect.objectContaining({ versionId: 'version-0' }),
        )
      },
    )

    it.each(['loading-plan', 'exporting'])('disables export while %s', async (state) => {
      if (state === 'loading-plan') exportState.plan = undefined
      else exportState.isExporting = true
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      const action = screen.getByRole('menuitem', { name: /export/i })
      expect(action).toHaveAttribute('aria-disabled', 'true')
      await user.click(action)
      expect(exportState.exportAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('Version restore', () => {
    const renderPanel = (onBeforeRestore?: () => void | Promise<void>) => {
      const onSelectVersion = vi.fn()
      const onVersionRestored = vi.fn().mockResolvedValue(undefined)
      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={onSelectVersion}
          onVersionRestored={onVersionRestored}
          onBeforeRestore={onBeforeRestore}
          onClose={vi.fn()}
        />,
      )
      return { onSelectVersion, onVersionRestored }
    }

    const openRestore = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      await user.click(screen.getByRole('menuitem', { name: /restore/i }))
    }

    it('restores the version whose menu was opened only after confirmation, then returns to the refreshed draft', async () => {
      const user = userEvent.setup()
      const { onSelectVersion, onVersionRestored } = renderPanel()
      await openRestore(user)
      const dialog = await screen.findByRole('alertdialog')
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
      expect(onSelectVersion).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole('button', { name: /restore/i }))
      await waitFor(() => expect(onSelectVersion).toHaveBeenCalledWith(null))
      expect(exportState.restoreVersion.mock.calls[0]?.[0]).toEqual({
        params: { agent_id: 'agent-1', version_id: 'version-0' },
      })
      expect(onVersionRestored.mock.invocationCallOrder[0]).toBeLessThan(
        onSelectVersion.mock.invocationCallOrder[0]!,
      )
    })

    it('does not restore when saving the existing draft fails', async () => {
      const user = userEvent.setup()
      const onBeforeRestore = vi.fn().mockRejectedValue(new Error('Draft save failed'))
      const { onSelectVersion, onVersionRestored } = renderPanel(onBeforeRestore)
      await openRestore(user)
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: /restore/i }),
      )
      await waitFor(() => expect(onBeforeRestore).toHaveBeenCalledTimes(1))
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
      expect(onSelectVersion).not.toHaveBeenCalled()
      expect(onVersionRestored).not.toHaveBeenCalled()
      expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    })

    it('cancels restoration without changing the selected version', async () => {
      const user = userEvent.setup()
      const { onSelectVersion } = renderPanel()
      await openRestore(user)
      await user.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: /cancel/i }),
      )
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
      expect(onSelectVersion).not.toHaveBeenCalled()
    })

    it('dismisses the agent upgrade dialog without restoring or opening pricing on the Cloud sandbox plan', async () => {
      exportState.plan = 'sandbox'
      const user = userEvent.setup()
      renderPanel()
      await openRestore(user)
      const dialog = await screen.findByRole('dialog', {
        name: 'billing.upgrade.agentRestore.title',
      })
      expect(dialog).toHaveAccessibleDescription('billing.upgrade.agentRestore.description')
      expect(exportState.onUrlUpdate).not.toHaveBeenCalled()
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
      await user.click(
        within(dialog).getByRole('button', { name: 'billing.triggerLimitModal.dismiss' }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(exportState.onUrlUpdate).not.toHaveBeenCalled()
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
    })

    it.each(['COMMUNITY', 'ENTERPRISE'])(
      'allows restoration on %s without a Cloud plan',
      async (edition) => {
        exportState.edition = edition
        exportState.plan = undefined
        const user = userEvent.setup()
        renderPanel()
        await openRestore(user)
        await user.click(
          within(await screen.findByRole('alertdialog')).getByRole('button', { name: /restore/i }),
        )
        await waitFor(() => expect(exportState.restoreVersion).toHaveBeenCalledTimes(1))
        expect(exportState.onUrlUpdate).not.toHaveBeenCalled()
      },
    )

    it('disables restoration until the Cloud plan is loaded', async () => {
      exportState.plan = undefined
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      const restore = screen.getByRole('menuitem', { name: /restore/i })
      expect(restore).toHaveAttribute('aria-disabled', 'true')
      await user.click(restore)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(exportState.restoreVersion).not.toHaveBeenCalled()
    })

    it('offers restore independently of export permission', async () => {
      exportState.canExport = false
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      expect(screen.getByRole('menuitem', { name: /restore/i })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: /export/i })).not.toBeInTheDocument()
    })

    it('hides restore without release permission while allowing export', async () => {
      exportState.canRestore = false
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      expect(screen.queryByRole('menuitem', { name: /restore/i })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: /export/i })).toBeInTheDocument()
    })
  })

  describe('Version selection', () => {
    it('should notify the selected version when a version row is clicked', () => {
      const handleSelectVersion = vi.fn()

      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={handleSelectVersion}
          onClose={vi.fn()}
        />,
        { accountProfile: { id: 'user-1', name: 'Alice', email: 'alice@example.com' } },
      )

      fireEvent.click(screen.getByRole('button', { name: /^Initial release/i }))

      expect(handleSelectVersion).toHaveBeenCalledWith('version-0')
    })

    it('should notify null when the current draft row is clicked', () => {
      const handleSelectVersion = vi.fn()

      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={handleSelectVersion}
          onClose={vi.fn()}
        />,
        { accountProfile: { id: 'user-1', name: 'Alice', email: 'alice@example.com' } },
      )

      fireEvent.click(screen.getByRole('button', { name: /currentDraft/i }))

      expect(handleSelectVersion).toHaveBeenCalledWith(null)
    })
  })

  describe('Version filter', () => {
    it('should show filter options when the filter trigger is clicked', () => {
      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={vi.fn()}
          onClose={vi.fn()}
        />,
        { accountProfile: { id: 'user-1', name: 'Alice', email: 'alice@example.com' } },
      )

      fireEvent.click(screen.getByRole('button', { name: /filter/i }))

      expect(screen.getByRole('button', { name: /all/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /onlyYours/i })).toBeInTheDocument()
      expect(screen.queryByText(/onlyShowNamedVersions/i)).not.toBeInTheDocument()
    })

    it('should only show current user versions when only yours is selected', () => {
      render(
        <AgentPreviewVersionsPanel
          agentId="agent-1"
          activeVersionId="version-2"
          onSelectVersion={vi.fn()}
          onClose={vi.fn()}
        />,
        { accountProfile: { id: 'user-1', name: 'Alice', email: 'alice@example.com' } },
      )

      fireEvent.click(screen.getByRole('button', { name: /filter/i }))
      fireEvent.click(screen.getByRole('button', { name: /onlyYours/i }))

      expect(screen.getByRole('button', { name: /^Published update/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Initial release/i })).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /^agentV2.agentDetail.versionHistory.versionName.*1/i,
        }),
      ).not.toBeInTheDocument()
    })
  })
})
