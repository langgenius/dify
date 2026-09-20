import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import { AgentPreviewVersionsPanel } from '../versions-panel'

const exportState = vi.hoisted(() => ({
  canExport: true,
  isExporting: false,
  edition: 'CLOUD',
  plan: 'professional' as string | undefined,
  exportAppDsl: vi.fn(),
  setPricing: vi.fn(),
}))

vi.mock('@/features/agent-v2/permissions', () => ({
  useAgentPermissions: () => ({
    canImportExportDSL: exportState.canExport,
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

vi.mock('nuqs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('nuqs')>()),
  useQueryState: () => [null, exportState.setPricing],
}))

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
        versions: {
          get: {
            queryOptions: () => ({ queryKey: ['agent-versions'] }),
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

    it('hides version actions without export permission', () => {
      exportState.canExport = false
      renderPanel()
      expect(screen.queryByRole('button', { name: /moreActions/ })).not.toBeInTheDocument()
    })

    it('opens pricing instead of exporting on the Cloud sandbox plan', async () => {
      exportState.plan = 'sandbox'
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /moreActions.*Initial release/ }))
      await user.click(screen.getByRole('menuitem', { name: /export/i }))
      expect(exportState.setPricing).toHaveBeenCalledWith('open')
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
