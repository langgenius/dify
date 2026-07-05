import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { RerankingModeEnum } from '@/models/datasets'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentKnowledgeRetrieval } from '../index'

vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset', () => ({
  default: function MockAddKnowledge({
    onChange,
  }: {
    onChange: (datasets: Array<{
      id: string
      name: string
      indexing_technique: string
      provider: string
      embedding_model_provider: string
      embedding_model: string
      retrieval_model_dict: {
        search_method: string
      }
      is_multimodal: boolean
    }>) => void
  }) {
    return (
      <button
        type="button"
        aria-label="common.operation.add workflow.nodes.knowledgeRetrieval.knowledge"
        onClick={() => onChange([{
          id: 'dataset-2',
          name: 'Release Docs',
          indexing_technique: 'high_quality',
          provider: 'internal',
          embedding_model_provider: 'openai',
          embedding_model: 'text-embedding-3',
          retrieval_model_dict: {
            search_method: 'semantic',
          },
          is_multimodal: false,
        }])}
      >
        Add mock knowledge
      </button>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(() => ({
    modelList: [{
      provider: 'rerank-provider',
      models: [{ model: 'rerank-model' }],
    }],
    defaultModel: {
      provider: {
        provider: 'rerank-provider',
      },
      model: 'rerank-model',
    },
  })),
  useCurrentProviderAndModel: vi.fn(() => ({
    currentProvider: { provider: 'rerank-provider' },
    currentModel: { model: 'rerank-model' },
  })),
}))

const agentKnowledgeDraft = {
  ...defaultAgentSoulConfigFormState,
  knowledgeRetrievals: [
    {
      id: 'retrieval-1',
      name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
    },
  ],
} satisfies AgentSoulConfigFormState

function ConfigSnapshotPreview() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

  return (
    <output aria-label="config snapshot">
      {JSON.stringify(configSnapshot.knowledge)}
    </output>
  )
}

function renderKnowledgeRetrieval({
  initialDraft = agentKnowledgeDraft,
  readOnly = false,
  showConfigSnapshot = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  readOnly?: boolean
  showConfigSnapshot?: boolean
} = {}) {
  const queryClient = new QueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentOrchestrateReadOnlyContext value={readOnly}>
          <AgentKnowledgeRetrieval />
        </AgentOrchestrateReadOnlyContext>
        {showConfigSnapshot && <ConfigSnapshotPreview />}
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

    it('should hide add, edit, and remove actions when readonly', () => {
      renderKnowledgeRetrieval({ readOnly: true })

      expect(screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.remove:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      })).not.toBeInTheDocument()
    })

    it('should keep row actions out of layout until hover or focus', () => {
      renderKnowledgeRetrieval()

      const editButton = screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      })
      const removeButton = screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.remove:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
      })
      const actionGroup = editButton.parentElement

      expect(actionGroup).toHaveClass('hidden')
      expect(actionGroup).toHaveClass(
        'group-focus-within:flex',
        'group-hover:flex',
      )
      expect(removeButton).toHaveClass(
        'hover:bg-state-destructive-hover',
        'hover:text-text-destructive',
        'focus-visible:bg-state-destructive-hover',
        'focus-visible:text-text-destructive',
      )
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
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo',
      })
      expect(titleButton).toBeInTheDocument()
      expect(within(dialog).queryByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).not.toBeInTheDocument()

      await user.click(titleButton)

      expect(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo')
      expect(within(dialog).queryByText('appDebug.datasetConfig.knowledgeTip')).not.toBeInTheDocument()
      expect(within(dialog).getByRole('button', {
        name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
      })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', {
        name: 'workflow.nodes.knowledgeRetrieval.metadata.options.disabled.title',
      })).toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo"}',
      })).not.toBeInTheDocument()
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

    it('should not create a new retrieval until knowledge is selected', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))

      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo"}',
      })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Close' }))

      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo"}',
      })).not.toBeInTheDocument()
    })

    it('should show inline validation for blank custom queries after knowledge is selected', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(within(dialog).getByRole('button', {
        name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
      }))

      await user.click(within(dialog).getByRole('radio', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
      }))

      expect(within(dialog).getByText('common.errorMsg.fieldRequired:{"field":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel"}')).toBeInTheDocument()
    })

    it('should not show inline validation for automatic metadata filtering without a model', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({
        initialDraft: {
          ...defaultAgentSoulConfigFormState,
          knowledgeRetrievals: [
            {
              id: 'retrieval-1',
              name: 'Docs Search',
              datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
              metadataFilterMode: MetadataFilteringModeEnum.automatic,
            },
          ],
        },
      })

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Docs Search"}',
      }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(within(dialog).queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.validation.metadataModelRequired')).not.toBeInTheDocument()
    })

    it('should show duplicate-name validation in the dialog', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({
        initialDraft: {
          ...defaultAgentSoulConfigFormState,
          knowledgeRetrievals: [
            {
              id: 'retrieval-1',
              name: 'Docs Search',
              datasetRefs: [{ id: 'dataset-1', name: 'Docs' }],
            },
            {
              id: 'retrieval-2',
              name: 'FAQ Search',
              datasetRefs: [{ id: 'dataset-2', name: 'FAQ' }],
            },
          ],
        },
      })

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"FAQ Search"}',
      }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(within(dialog).getByRole('button', {
        name: 'FAQ Search',
      }))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Docs Search')
      fireEvent.blur(nameInput)

      expect(within(dialog).getByText('appDebug.varKeyError.keyAlreadyExists:{"key":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel"}')).toBeInTheDocument()
    })

    it('should save newly added retrieval data into the config snapshot', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showConfigSnapshot: true })

      await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add' }))
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(within(dialog).getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo',
      })).toBeInTheDocument()

      await user.click(within(dialog).getByRole('radio', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
      }))
      await user.type(within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
      }), 'new release notes')
      await user.click(within(dialog).getByRole('button', {
        name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
      }))

      const knowledgeConfig = JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
      expect(knowledgeConfig.sets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'retrieval-1',
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
          datasets: [],
          query: {
            mode: 'generated_query',
          },
        }),
        expect.objectContaining({
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo',
          datasets: [
            expect.objectContaining({
              id: 'dataset-2',
              name: 'Release Docs',
            }),
          ],
          query: {
            mode: 'user_query',
            value: 'new release notes',
          },
          retrieval: expect.objectContaining({
            mode: 'multiple',
            reranking_enable: true,
            reranking_mode: RerankingModeEnum.RerankingModel,
            reranking_model: {
              provider: 'rerank-provider',
              model: 'rerank-model',
            },
            top_k: 4,
          }),
        }),
      ]))
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

    it('should show hydrated backend datasets in the edit dialog', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({
        initialDraft: {
          ...defaultAgentSoulConfigFormState,
          knowledgeRetrievals: [
            {
              id: 'dataset-1',
              name: 'Search Docs',
              datasetRefs: [
                {
                  id: 'dataset-1',
                  name: 'Product Docs',
                  description: 'Docs corpus',
                },
              ],
            },
          ],
        },
      })

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Search Docs"}',
      }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(within(dialog).getByText('Product Docs')).toBeInTheDocument()
      expect(within(dialog).queryByText('appDebug.datasetConfig.knowledgeTip')).not.toBeInTheDocument()
    })

    it('should save the default rerank model when editing retrieval with existing knowledge', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({
        showConfigSnapshot: true,
        initialDraft: {
          ...defaultAgentSoulConfigFormState,
          knowledgeRetrievals: [
            {
              id: 'retrieval-1',
              name: 'Search Docs',
              datasetRefs: [
                {
                  id: 'dataset-1',
                  name: 'Product Docs',
                  description: 'Docs corpus',
                },
              ],
              multipleRetrievalConfig: {
                top_k: 4,
                score_threshold: null,
                reranking_enable: false,
              },
            },
          ],
        },
      })

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Search Docs"}',
      }))

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(within(dialog).getByRole('button', {
        name: 'Search Docs',
      }))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Default Rerank Docs')

      await waitFor(() => {
        const knowledgeConfig = JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
        expect(knowledgeConfig.sets[0].retrieval).toEqual(expect.objectContaining({
          mode: 'multiple',
          reranking_enable: true,
          reranking_mode: RerankingModeEnum.RerankingModel,
          reranking_model: {
            provider: 'rerank-provider',
            model: 'rerank-model',
          },
        }))
      })
    })

    it('should save edited retrieval data into the config snapshot', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showConfigSnapshot: true })

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

      const knowledgeConfig = JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
      expect(knowledgeConfig).toMatchObject({
        sets: [
          {
            id: 'retrieval-1',
            name: 'Release Search',
            datasets: [],
            query: {
              mode: 'user_query',
              value: 'release notes',
            },
            retrieval: {
              mode: 'multiple',
              top_k: 4,
            },
          },
        ],
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
