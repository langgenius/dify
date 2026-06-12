import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { defaultAgentConfigureDraft } from '../../../../draft'
import { AgentTools } from '../index'

function renderAgentTools() {
  return render(
    <AgentComposerProvider initialDraft={defaultAgentConfigureDraft}>
      <AgentTools />
    </AgentComposerProvider>,
  )
}

describe('AgentTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('User Interactions', () => {
    it('should remove a provider action when the remove button is clicked', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'DuckDuckGo',
      }))

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
      }))

      expect(screen.queryByText('DuckDuckGo Image Search')).not.toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo Search')).toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo')).toBeInTheDocument()
    })

    it('should remove all provider tools from the provider more-actions menu', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
      }))
      await user.click(screen.getByRole('menuitem', {
        name: /agentV2\.agentDetail\.configure\.tools\.removeProvider/,
      }))

      expect(screen.queryByText('DuckDuckGo')).not.toBeInTheDocument()
      expect(screen.queryByText('DuckDuckGo Search')).not.toBeInTheDocument()
      expect(screen.getByText('Lark CLI')).toBeInTheDocument()
    })
  })
})
