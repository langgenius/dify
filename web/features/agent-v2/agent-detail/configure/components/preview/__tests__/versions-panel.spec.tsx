import type { AgentConfigSnapshotSummaryResponse } from '@dify/contracts/api/console/agent/types.gen'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentPreviewVersionsPanel } from '../versions-panel'

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
    useQuery: () => ({
      data: { data: versions },
      isPending: false,
    }),
  }
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
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

vi.mock('@/context/app-context-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateAtomMock(importOriginal, () => ({
    userProfile: {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@example.com',
    },
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } = await import('@/__tests__/utils/mock-app-context-state')

  return createAppContextStateJotaiMock(importOriginal)
})

describe('AgentPreviewVersionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      )

      fireEvent.click(screen.getByRole('button', { name: /Initial release/i }))

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
      )

      fireEvent.click(screen.getByRole('button', { name: /filter/i }))
      fireEvent.click(screen.getByRole('button', { name: /onlyYours/i }))

      expect(screen.getByRole('button', { name: /Published update/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Initial release/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /versionName.*1/i })).not.toBeInTheDocument()
    })
  })
})
