import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { AgentFiles } from '../index'

const agentFilesDraft = {
  ...defaultAgentSoulConfigFormState,
  files: [
    {
      id: 'preview-image',
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
      icon: 'image',
    },
    {
      id: 'brief',
      name: 'brief.md',
      icon: 'markdown',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

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

  it('should open the shared detail dialog with the full file tree when the file row is clicked', () => {
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
    }))

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getAllByText('agent-roster-skill-detail-dialog-preview-image.png')).toHaveLength(2)
    expect(within(dialog).getByText('brief.md')).toBeInTheDocument()
  })

  // File rows expose a hover/focus remove action that updates the composer draft.
  it('should remove the file from the list when the remove action is clicked', () => {
    renderAgentFiles()

    expect(screen.getByText('agent-roster-skill-detail-dialog-preview-image.png')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))

    expect(screen.queryByText('agent-roster-skill-detail-dialog-preview-image.png')).not.toBeInTheDocument()
    expect(screen.getByText('brief.md')).toBeInTheDocument()
  })

  it('should render the empty state after removing every file', () => {
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))
    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*brief\.md/,
    }))

    expect(screen.getByText('agentV2.agentDetail.configure.files.empty.title')).toBeInTheDocument()
  })
})
