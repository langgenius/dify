import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { AgentFiles } from '../files'
import { AgentKnowledgeRetrieval } from '../knowledge'
import { AgentSkills } from '../skills'
import { AgentTools } from '../tools'

function renderEmptySections() {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider
        initialDraft={{
          ...defaultAgentSoulConfigFormState,
          files: [],
          knowledgeRetrievals: [],
          skills: [],
          tools: [],
        }}
      >
        <AgentSkills agentId="agent-1" />
        <AgentFiles agentId="agent-1" />
        <AgentTools />
        <AgentKnowledgeRetrieval />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

describe('Agent configure empty sections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Empty composer resources should still render scannable placeholders in each section.
  it('should render placeholders when resources are empty', () => {
    renderEmptySections()

    expect(screen.getByText('agentV2.agentDetail.configure.skills.empty.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.skills.empty.description')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.files.empty.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.files.empty.description')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.tools.empty.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.tools.empty.description')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.empty.title')).toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.empty.description')).toBeInTheDocument()
  })
})
