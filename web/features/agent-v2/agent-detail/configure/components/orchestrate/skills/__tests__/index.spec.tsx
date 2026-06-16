import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { AgentSkills } from '../index'

const mocks = vi.hoisted(() => ({
  driveFilesQueryOptions: vi.fn(),
  uploadSkillMutationOptions: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        drive: {
          files: {
            get: {
              queryOptions: mocks.driveFilesQueryOptions,
            },
          },
        },
        skills: {
          upload: {
            post: {
              mutationOptions: mocks.uploadSkillMutationOptions,
            },
          },
        },
      },
    },
  },
}))

const agentSkillsDraft = {
  ...defaultAgentSoulConfigFormState,
  skills: [
    {
      id: 'tender-analyzer',
      name: 'Tender Analyzer',
      description: 'Extracts tender requirements and scoring criteria.',
      files: ['SKILL.md', 'schema.json'],
      path: 'tender-analyzer',
      skillMdKey: 'tender-analyzer/SKILL.md',
    },
    {
      id: 'meeting-brief',
      name: 'Meeting Brief',
      path: 'meeting-brief',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

function renderAgentSkills() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={agentSkillsDraft}>
        <AgentSkills agentId="agent-1" />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

describe('AgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.driveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      queryFn: async () => ({
        items: [
          {
            file_kind: 'file',
            key: 'tender-analyzer/SKILL.md',
          },
          {
            file_kind: 'file',
            key: 'tender-analyzer/scripts/extract.py',
          },
        ],
      }),
    }))
    mocks.uploadSkillMutationOptions.mockReturnValue({
      mutationFn: vi.fn(),
      mutationKey: ['upload-skill'],
    })
  })

  // Skill rows load their preview from the agent drive and render the shared detail dialog.
  it('should fetch drive files and open the skill detail dialog when the skill row is clicked', async () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBeInTheDocument()
    expect(mocks.driveFilesQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          prefix: 'tender-analyzer',
        },
      },
    })
    expect(within(dialog).getByText('Tender Analyzer')).toBeInTheDocument()
    expect(within(dialog).getByText('Extracts tender requirements and scoring criteria.')).toBeInTheDocument()
    expect(await within(dialog).findByText('scripts/extract.py')).toBeInTheDocument()
    expect(within(dialog).getByText('SKILL.md')).toBeInTheDocument()
  })

  // The hover/focus remove action updates the composer draft without opening preview.
  it('should remove the skill without opening the detail dialog when the remove action is clicked', () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    expect(screen.queryByText('Tender Analyzer')).not.toBeInTheDocument()
    expect(screen.getByText('Meeting Brief')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
