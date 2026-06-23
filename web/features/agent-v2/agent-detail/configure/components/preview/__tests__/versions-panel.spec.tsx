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
    version_note: 'Initial release',
    created_at: 1710000000,
    created_by: 'Bob',
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

      expect(handleSelectVersion).toHaveBeenCalledWith('version-1')
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
})
