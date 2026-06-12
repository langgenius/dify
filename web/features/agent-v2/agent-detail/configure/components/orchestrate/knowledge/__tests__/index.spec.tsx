import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { defaultAgentConfigureDraft } from '../../../../draft'
import { AgentKnowledgeRetrieval } from '../index'

function renderKnowledgeRetrieval() {
  return render(
    <AgentComposerProvider initialDraft={defaultAgentConfigureDraft}>
      <AgentKnowledgeRetrieval />
    </AgentComposerProvider>,
  )
}

describe('AgentKnowledgeRetrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render configured retrieval rows', () => {
      renderKnowledgeRetrieval()

      expect(screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')).toBeInTheDocument()
      expect(screen.queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should open the knowledge retrieval dialog from the add button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      expect(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')
      expect(within(dialog).getByText('agentV2.agentDetail.configure.knowledgeRetrieval.dialog.knowledge.empty')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.metadata.conditions 2',
      })).toBeInTheDocument()
    })

    it('should update the query description when query mode changes', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(within(dialog).getByRole('radio', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
      }))

      expect(within(dialog).getByText('agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription')).toBeInTheDocument()
    })

    it('should open the knowledge retrieval dialog from the edit button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      expect(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')
    })

    it('should remove the knowledge retrieval row from the remove button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.remove:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      }))

      expect(screen.queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')).not.toBeInTheDocument()
      expect(screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.empty.title')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should close the dialog from the close button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))
      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(screen.queryByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })).not.toBeInTheDocument()
    })
  })
})
