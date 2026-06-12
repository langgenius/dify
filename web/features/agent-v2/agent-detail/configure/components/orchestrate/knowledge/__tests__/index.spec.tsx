import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useConfigPublishPayload } from '@/features/agent-v2/agent-composer/store'
import { defaultAgentConfigureDraft } from '../../../../draft'
import { AgentKnowledgeRetrieval } from '../index'

function PublishPayloadPreview() {
  const payload = useConfigPublishPayload({ agentId: 'agent-1' })

  return (
    <output aria-label="publish payload">
      {JSON.stringify(payload.config_snapshot.knowledge)}
    </output>
  )
}

function renderKnowledgeRetrieval({ showPublishPayload = false } = {}) {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={defaultAgentConfigureDraft}>
        <AgentKnowledgeRetrieval />
        {showPublishPayload && <PublishPayloadPreview />}
      </AgentComposerProvider>
    </QueryClientProvider>,
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
      const titleButton = within(dialog).getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
      })
      expect(titleButton).toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).not.toBeInTheDocument()

      await user.click(titleButton)

      expect(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')
      expect(within(dialog).getByText('appDebug.datasetConfig.knowledgeTip')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', {
        name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
      })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', {
        name: 'workflow.nodes.knowledgeRetrieval.metadata.options.disabled.title',
      })).toBeInTheDocument()
    })

    it('should show the custom query input when query mode changes', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(within(dialog).getByRole('radio', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
      }))

      const customQueryInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
      })
      await user.type(customQueryInput, 'release notes')

      expect(customQueryInput).toHaveValue('release notes')
      expect(within(dialog).getByPlaceholderText('agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customPlaceholder')).toBeInTheDocument()
      expect(within(dialog).getByText('agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription')).toBeInTheDocument()
      expect(within(dialog).queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.agentDescription')).not.toBeInTheDocument()
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
      await user.click(within(dialog).getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
      }))

      expect(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')
    })

    it('should save edited retrieval data into the publish config', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showPublishPayload: true })

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      }))
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(within(dialog).getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
      }))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Release Search')
      await user.click(within(dialog).getByRole('radio', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
      }))
      await user.type(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
      }), 'release notes')

      const knowledgeConfig = JSON.parse(screen.getByLabelText('publish payload').textContent ?? '{}')
      expect(knowledgeConfig).toMatchObject({
        datasets: [
          {
            id: 'retrieval-1',
            name: 'Release Search',
          },
        ],
        query_config: {
          query: 'release notes',
          top_k: 4,
        },
        query_mode: 'user_query',
      })
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
