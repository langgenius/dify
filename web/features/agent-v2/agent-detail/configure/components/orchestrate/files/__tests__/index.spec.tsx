import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { defaultAgentComposerDraft } from '@/features/agent-v2/agent-composer/store'
import { AgentFiles } from '../index'

const agentFilesDraft = {
  ...defaultAgentComposerDraft,
  files: [
    {
      id: 'preview-image',
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
      icon: 'image',
    },
  ],
} satisfies typeof defaultAgentComposerDraft

function renderAgentFiles() {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={agentFilesDraft}>
        <AgentFiles />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

describe('AgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // File rows expose a hover/focus remove action that updates the composer draft.
  it('should remove the file from the list when the remove action is clicked', () => {
    renderAgentFiles()

    expect(screen.getByText('agent-roster-skill-detail-dialog-preview-image.png')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove/,
    }))

    expect(screen.queryByText('agent-roster-skill-detail-dialog-preview-image.png')).not.toBeInTheDocument()
    expect(screen.getByText('agentV2.agentDetail.configure.files.empty.title')).toBeInTheDocument()
  })
})
