import type { Node, Var } from '@/app/components/workflow/types'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import type { MetadataInDoc } from '@/models/datasets'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { ReactFlowProvider } from 'reactflow'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  ComparisonOperator,
  LogicalOperator,
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { RerankingModeEnum } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AgentOrchestratePanel } from '../../index'
import {
  AgentOrchestrateReadOnlyContext,
  AgentOrchestrateViewingVersionContext,
} from '../../read-only-context'
import { AgentKnowledgeRetrieval } from '../index'

vi.mock('@/features/agent-v2/agent-detail/configure/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/features/agent-v2/agent-detail/configure/feature-flags')
  >()),
  ENABLE_AGENT_KNOWLEDGE_RETRIEVAL: true,
}))

// Keep the configuration panel and retrieval editor real; unrelated editors have their own suites.
vi.mock('../../advanced', () => ({ AgentAdvancedSettings: () => null }))
vi.mock('../../model-config/field', () => ({ AgentModelField: () => null }))
vi.mock('../../prompt-editor', () => ({
  AgentPromptEditor: () => null,
  AgentTemplatePromptEditor: () => null,
}))
vi.mock('../../skills', () => ({ AgentSkills: () => null, AgentTemplateSkills: () => null }))
vi.mock('../../files', () => ({ AgentFiles: () => null, AgentTemplateFiles: () => null }))
vi.mock('../../tools', () => ({ AgentTools: () => null, AgentTemplateTools: () => null }))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: (_nodeId: string, { filterVar }: { filterVar: (value: Var) => boolean }) => ({
    availableVars: [
      {
        nodeId: 'start',
        title: 'Start',
        isStartNode: true,
        vars: [
          { variable: 'program_input', type: VarType.number },
          { variable: 'item_input', type: VarType.string },
        ].filter(filterVar),
      },
    ],
    availableNodesWithParent: [
      {
        id: 'start',
        position: { x: 0, y: 0 },
        data: { type: BlockEnum.Start, title: 'Start', desc: '' },
      } satisfies Node,
    ],
  }),
}))

const datasetQuery = vi.hoisted(() => ({
  pages: [] as Array<{ data: unknown[] }>,
  notify: () => {},
  error: null as Error | null,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const datasetsQuery = new Proxy(actual.consoleQuery.datasets, {
    get(target, property, receiver) {
      if (property !== 'get') return Reflect.get(target, property, receiver)
      return {
        ...target.get,
        queryOptions: (...args: Parameters<typeof target.get.queryOptions>) => ({
          ...target.get.queryOptions(...args),
          retry: false,
          initialData: datasetQuery.pages[0],
          queryFn: () => {
            if (datasetQuery.error) return Promise.reject(datasetQuery.error)
            return new Promise((resolve) => {
              datasetQuery.notify = () => resolve(datasetQuery.pages[0])
            })
          },
        }),
      }
    },
  })
  return {
    ...actual,
    consoleQuery: new Proxy(actual.consoleQuery, {
      get(target, property, receiver) {
        if (property === 'datasets') return datasetsQuery
        return Reflect.get(target, property, receiver)
      },
    }),
  }
})

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

vi.mock('@/app/components/workflow/nodes/knowledge-retrieval/components/add-dataset', () => ({
  default: function MockAddKnowledge({
    onChange,
  }: {
    onChange: (
      datasets: Array<{
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
        doc_metadata: MetadataInDoc[]
      }>,
    ) => void
  }) {
    return (
      <button
        type="button"
        aria-label="common.operation.add workflow.nodes.knowledgeRetrieval.knowledge"
        onClick={() =>
          onChange([
            {
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
              doc_metadata: [
                {
                  id: 'program-metadata',
                  name: 'guide_program_id',
                  type: MetadataFilteringVariableType.number,
                  value: '',
                },
                {
                  id: 'item-metadata',
                  name: 'guide_item_id',
                  type: MetadataFilteringVariableType.string,
                  value: '',
                },
              ],
            },
          ])
        }
      >
        Add mock knowledge
      </button>
    )
  },
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: vi.fn(() => ({
    modelList: [
      {
        provider: 'rerank-provider',
        models: [{ model: 'rerank-model' }],
      },
    ],
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

  return <output aria-label="config snapshot">{JSON.stringify(configSnapshot.knowledge)}</output>
}

function renderKnowledgeRetrieval({
  initialDraft = agentKnowledgeDraft,
  readOnly = false,
  viewingVersion = false,
  showConfigSnapshot = false,
  workflowNodeId,
  throughPanel = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  readOnly?: boolean
  viewingVersion?: boolean
  showConfigSnapshot?: boolean
  workflowNodeId?: string
  throughPanel?: boolean
} = {}) {
  return render(
    <AgentComposerProvider initialDraft={initialDraft}>
      <AgentOrchestrateViewingVersionContext value={viewingVersion}>
        <AgentOrchestrateReadOnlyContext value={readOnly}>
          {workflowNodeId ? (
            <ReactFlowProvider>
              {throughPanel ? (
                <AgentOrchestratePanel
                  agentId="agent-1"
                  appId="workflow-1"
                  nodeId={workflowNodeId}
                  showHeader={false}
                  showPublishBar={false}
                  onSelectModel={() => {}}
                />
              ) : (
                <AgentKnowledgeRetrieval workflowNodeId={workflowNodeId} />
              )}
            </ReactFlowProvider>
          ) : (
            <AgentKnowledgeRetrieval />
          )}
        </AgentOrchestrateReadOnlyContext>
      </AgentOrchestrateViewingVersionContext>
      {showConfigSnapshot && <ConfigSnapshotPreview />}
    </AgentComposerProvider>,
  )
}

function getDialogNameEditButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', {
    name: /agentDetail\.configure\.knowledgeRetrieval\.edit/,
  })
}

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('AgentKnowledgeRetrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    datasetQuery.pages = []
    datasetQuery.error = null
  })

  describe('Rendering', () => {
    it('should render configured retrieval rows', () => {
      renderKnowledgeRetrieval()

      expect(
        screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne'),
      ).toBeInTheDocument()
      expect(
        screen.queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo'),
      ).not.toBeInTheDocument()
    })

    it('should hide add, edit, and remove actions when viewing a version', () => {
      renderKnowledgeRetrieval({ readOnly: true, viewingVersion: true })

      expect(
        screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.remove:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      ).not.toBeInTheDocument()
    })

    it('should keep add action available for build drafts', () => {
      renderKnowledgeRetrieval({ readOnly: true })

      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      ).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it.each(['failed', 'missing'])(
      'preserves saved filters and allows recovery when dataset metadata is %s',
      async (result) => {
        const user = userEvent.setup()
        if (result === 'failed') datasetQuery.error = new Error('Dataset request failed')
        else datasetQuery.pages = [{ data: [] }]
        renderKnowledgeRetrieval({
          workflowNodeId: 'agent-node',
          showConfigSnapshot: true,
          initialDraft: {
            ...agentKnowledgeDraft,
            knowledgeRetrievals: [
              {
                id: 'retrieval-1',
                name: 'Guide retrieval',
                datasetRefs: [{ id: 'dataset-1', name: 'Guide knowledge' }],
                metadataFilterMode: MetadataFilteringModeEnum.manual,
                metadataFilteringConditions: {
                  logical_operator: LogicalOperator.and,
                  conditions: [
                    {
                      id: 'condition-1',
                      metadata_id: 'guide-metadata',
                      name: 'guide_item_id',
                      comparison_operator: ComparisonOperator.is,
                      value: '{{#start.item_input#}}',
                    },
                  ],
                },
              },
            ],
          },
        })
        await user.click(
          screen.getByRole('button', {
            name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Guide retrieval"}',
          }),
        )
        expect(await screen.findByRole('alert')).toHaveTextContent('common.dynamicSelect.error')
        expect(
          screen.queryByRole('progressbar', { name: 'appApi.loading' }),
        ).not.toBeInTheDocument()
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent('{{#start.item_input#}}')
        await user.click(screen.getByRole('button', { name: /metadata.options.manual.title/ }))
        await user.click(
          screen.getByRole('menuitemradio', { name: /metadata.options.disabled.title/ }),
        )
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent('"mode":"disabled"')

        datasetQuery.error = null
        datasetQuery.pages = [
          {
            data: [
              {
                id: 'dataset-1',
                name: 'Guide knowledge',
                doc_metadata: [{ id: 'guide-metadata', name: 'guide_item_id', type: 'string' }],
              },
            ],
          },
        ]
        await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))
        await act(async () => {
          datasetQuery.notify()
        })
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
        await user.click(
          await screen.findByRole('button', { name: /metadata.options.disabled.title/ }),
        )
        await user.click(
          screen.getByRole('menuitemradio', { name: /metadata.options.manual.title/ }),
        )
        await user.click(await screen.findByRole('button', { name: /metadata.panel.conditions/ }))
        expect(screen.getByRole('button', { name: 'Variable' })).toBeInTheDocument()
        expect(screen.getByText('item_input')).toBeInTheDocument()
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent('{{#start.item_input#}}')
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      },
    )

    it.each([false, true])(
      'preserves saved metadata conditions while dataset definitions are loaded: %s',
      async (loaded) => {
        const user = userEvent.setup()
        if (loaded)
          datasetQuery.pages = [
            {
              data: [
                {
                  id: 'dataset-1',
                  name: 'Guide knowledge',
                  doc_metadata: [
                    { id: 'program-metadata', name: 'guide_program_id', type: 'string' },
                  ],
                },
              ],
            },
          ]
        const draft: AgentSoulConfigFormState = {
          ...agentKnowledgeDraft,
          knowledgeRetrievals: [
            {
              id: 'retrieval-1',
              name: 'Guide retrieval',
              datasetRefs: [{ id: 'dataset-1', name: 'Guide knowledge' }],
              metadataFilterMode: MetadataFilteringModeEnum.manual,
              metadataFilteringConditions: {
                logical_operator: LogicalOperator.and,
                conditions: [
                  {
                    id: 'condition-1',
                    metadata_id: 'program-metadata',
                    name: 'guide_program_id',
                    comparison_operator: ComparisonOperator.is,
                    value: '{{#start.item_input#}}',
                  },
                ],
              },
            },
          ],
        }
        renderKnowledgeRetrieval({
          initialDraft: draft,
          showConfigSnapshot: true,
          workflowNodeId: 'agent-node',
        })
        await user.click(
          screen.getByRole('button', {
            name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Guide retrieval"}',
          }),
        )
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent('{{#start.item_input#}}')
        if (loaded) {
          await user.click(screen.getByRole('button', { name: /metadata.panel.conditions/ }))
          expect(screen.getByText('guide_program_id')).toBeInTheDocument()
          await user.click(screen.getByRole('button', { name: /metadata.panel.add/ }))
          expect(screen.getAllByText('guide_program_id')).toHaveLength(2)
        } else {
          expect(screen.getByRole('progressbar', { name: 'appApi.loading' })).toBeInTheDocument()
          expect(
            screen.queryByRole('button', { name: /metadata.panel.conditions/ }),
          ).not.toBeInTheDocument()
        }
      },
    )

    it.each([
      ['string', 'item_input', ComparisonOperator.is],
      ['number', 'program_input', ComparisonOperator.equal],
    ] as const)(
      'waits for metadata before editing a saved %s variable',
      async (metadataType, variableName, comparisonOperator) => {
        const user = userEvent.setup()
        const value = `{{#start.${variableName}#}}`
        renderKnowledgeRetrieval({
          workflowNodeId: 'agent-node',
          showConfigSnapshot: true,
          initialDraft: {
            ...agentKnowledgeDraft,
            knowledgeRetrievals: [
              {
                id: 'retrieval-1',
                name: 'Guide retrieval',
                datasetRefs: [{ id: 'dataset-1', name: 'Guide knowledge' }],
                metadataFilterMode: MetadataFilteringModeEnum.manual,
                metadataFilteringConditions: {
                  logical_operator: LogicalOperator.and,
                  conditions: [
                    {
                      id: 'condition-1',
                      metadata_id: 'guide-metadata',
                      name: 'guide_item_id',
                      comparison_operator: comparisonOperator,
                      value,
                    },
                  ],
                },
              },
            ],
          },
        })
        await user.click(
          screen.getByRole('button', {
            name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Guide retrieval"}',
          }),
        )
        expect(screen.getByRole('progressbar', { name: 'appApi.loading' })).toBeInTheDocument()
        expect(
          screen.queryByRole('button', { name: /metadata.panel.conditions/ }),
        ).not.toBeInTheDocument()
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent(value)

        await act(async () => {
          datasetQuery.pages = [
            {
              data: [
                {
                  id: 'dataset-1',
                  name: 'Guide knowledge',
                  doc_metadata: [
                    { id: 'guide-metadata', name: 'guide_item_id', type: metadataType },
                  ],
                },
              ],
            },
          ]
          datasetQuery.notify()
        })

        await user.click(await screen.findByRole('button', { name: /metadata.panel.conditions/ }))
        expect(
          screen.queryByRole('progressbar', { name: 'appApi.loading' }),
        ).not.toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Variable' })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: 'Constant' })).not.toBeInTheDocument()
        expect(screen.getByText(variableName)).toBeInTheDocument()
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent(value)
      },
    )

    it.each([
      ['guide_program_id', 'program_input', 'item_input'],
      ['guide_item_id', 'item_input', 'program_input'],
    ])(
      'should save a matching workflow variable for %s through the configuration panel',
      async (metadataName, variableName, otherTypeVariable) => {
        const user = userEvent.setup()
        renderKnowledgeRetrieval({
          workflowNodeId: 'agent-node',
          showConfigSnapshot: true,
          throughPanel: true,
        })

        await user.click(
          screen.getByRole('button', {
            name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
          }),
        )
        await user.click(
          screen.getByRole('button', {
            name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
          }),
        )
        await user.click(
          screen.getByRole('button', {
            name: 'workflowModels.nodes.knowledgeRetrieval.metadata.options.disabled.title',
          }),
        )
        await user.click(
          screen.getByRole('menuitemradio', { name: /metadata.options.manual.title/ }),
        )
        await user.click(screen.getByRole('button', { name: /metadata.panel.conditions/ }))
        await user.click(
          screen.getByRole('button', {
            name: 'workflowModels.nodes.knowledgeRetrieval.metadata.panel.add',
          }),
        )
        await user.click(screen.getByText(metadataName))
        await user.click(screen.getByRole('button', { name: 'Constant' }))
        await user.click(screen.getByText('Variable', { exact: true }))
        await user.click(
          screen.getByText('workflowModels.nodes.knowledgeRetrieval.metadata.panel.select'),
        )

        expect(screen.queryByText(otherTypeVariable)).not.toBeInTheDocument()
        await user.click(screen.getByText(variableName))
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent(
          `{{#start.${variableName}#}}`,
        )
        expect(screen.getByLabelText('config snapshot')).toHaveTextContent(metadataName)
      },
    )

    it('should open the knowledge retrieval dialog from the add button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      const titleButton = getDialogNameEditButton(dialog)
      expect(titleButton).toBeInTheDocument()
      expect(titleButton).toHaveTextContent(
        'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo',
      )
      expect(
        within(dialog).queryByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
        }),
      ).not.toBeInTheDocument()

      await user.click(titleButton)

      expect(
        within(dialog).getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
        }),
      ).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo')
      expect(
        within(dialog).queryByText('appDebug.datasetConfig.knowledgeTip'),
      ).not.toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', {
          name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
        }),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('button', {
          name: 'workflowModels.nodes.knowledgeRetrieval.metadata.options.disabled.title',
        }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo"}',
        }),
      ).not.toBeInTheDocument()
    })

    it('should show the custom query input when query mode changes', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
        }),
      )

      const customQueryInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
      })
      await user.type(customQueryInput, 'release notes')

      expect(customQueryInput).toHaveValue('release notes')
      expect(
        within(dialog).getByPlaceholderText(
          'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customPlaceholder',
        ),
      ).toBeInTheDocument()
      expect(
        within(dialog).getByText(
          'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customDescription',
        ),
      ).toBeInTheDocument()
      expect(
        within(dialog).queryByText(
          'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.agentDescription',
        ),
      ).not.toBeInTheDocument()
    })

    it('should not create a new retrieval until knowledge is selected', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )

      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo"}',
        }),
      ).not.toBeInTheDocument()
    })

    it('should show inline validation for blank custom queries after knowledge is selected', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(
        within(dialog).getByRole('button', {
          name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
        }),
      )

      await user.click(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
        }),
      )

      expect(
        within(dialog).getByText(
          'common.errorMsg.fieldRequired:{"field":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel"}',
        ),
      ).toBeInTheDocument()
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

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Docs Search"}',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(
        within(dialog).queryByText(
          'agentV2.agentDetail.configure.knowledgeRetrieval.validation.metadataModelRequired',
        ),
      ).not.toBeInTheDocument()
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

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"FAQ Search"}',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(getDialogNameEditButton(dialog))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Docs Search')
      fireEvent.blur(nameInput)

      expect(
        within(dialog).getByText(
          'appDebug.varKeyError.keyAlreadyExists:{"key":"agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel"}',
        ),
      ).toBeInTheDocument()
    })

    it('should save newly added retrieval data into the config snapshot', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showConfigSnapshot: true })

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(getDialogNameEditButton(dialog)).toHaveTextContent(
        'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalTwo',
      )

      await user.click(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
        }),
      )
      await user.type(
        within(dialog).getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
        }),
        'new release notes',
      )
      await user.click(
        within(dialog).getByRole('button', {
          name: 'common.operation.add workflow.nodes.knowledgeRetrieval.knowledge',
        }),
      )

      const knowledgeConfig = JSON.parse(
        screen.getByLabelText('config snapshot').textContent ?? '{}',
      )
      expect(knowledgeConfig.sets).toEqual(
        expect.arrayContaining([
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
        ]),
      )
    })

    it('should open the knowledge retrieval dialog from the edit button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(getDialogNameEditButton(dialog))

      expect(
        within(dialog).getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
        }),
      ).toHaveValue('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne')
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

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Search Docs"}',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      expect(within(dialog).getByText('Product Docs')).toBeInTheDocument()
      expect(
        within(dialog).queryByText('appDebug.datasetConfig.knowledgeTip'),
      ).not.toBeInTheDocument()
    })

    it('should preserve retrieval settings when renaming a retrieval', async () => {
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

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"Search Docs"}',
        }),
      )

      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(getDialogNameEditButton(dialog))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Renamed Docs{Enter}')

      const titleButton = getDialogNameEditButton(dialog)
      expect(titleButton).toHaveTextContent('Renamed Docs')
      expect(titleButton).toHaveFocus()
      const knowledgeConfig = JSON.parse(
        screen.getByLabelText('config snapshot').textContent ?? '{}',
      )
      expect(knowledgeConfig.sets[0]).toMatchObject({
        name: 'Renamed Docs',
        retrieval: {
          mode: 'multiple',
          reranking_enable: false,
          top_k: 4,
        },
      })
      expect(knowledgeConfig.sets[0].retrieval).not.toHaveProperty('reranking_model')
    })

    it('should cancel name editing with Escape without closing the dialog', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showConfigSnapshot: true })

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(getDialogNameEditButton(dialog))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Draft name')
      await user.keyboard('{Escape}')

      expect(dialog).toBeInTheDocument()
      const titleButton = getDialogNameEditButton(dialog)
      expect(titleButton).toHaveTextContent(
        'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
      )
      expect(titleButton).toHaveFocus()
      const knowledgeConfig = JSON.parse(
        screen.getByLabelText('config snapshot').textContent ?? '{}',
      )
      expect(knowledgeConfig.sets[0].name).toBe(
        'agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne',
      )
    })

    it('should keep editing when Enter confirms an IME composition', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(getDialogNameEditButton(dialog))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })

      fireEvent.keyDown(nameInput, { key: 'Enter', isComposing: true })

      expect(nameInput).toBeInTheDocument()
      expect(nameInput).toHaveFocus()
    })

    it('should save edited retrieval data into the config snapshot', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval({ showConfigSnapshot: true })

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.edit:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      )
      const dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })

      await user.click(getDialogNameEditButton(dialog))
      const nameInput = within(dialog).getByRole('textbox', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.nameLabel',
      })
      await user.clear(nameInput)
      await user.type(nameInput, 'Release Search')
      await user.click(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
        }),
      )
      await user.type(
        within(dialog).getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
        }),
        'release notes',
      )

      const knowledgeConfig = JSON.parse(
        screen.getByLabelText('config snapshot').textContent ?? '{}',
      )
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

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.remove:{"name":"agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne"}',
        }),
      )

      expect(
        screen.queryByText('agentV2.agentDetail.configure.knowledgeRetrieval.retrievalOne'),
      ).not.toBeInTheDocument()
      expect(
        screen.getByText('agentV2.agentDetail.configure.knowledgeRetrieval.empty.title'),
      ).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should close the dialog from the close button', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(
        screen.queryByRole('dialog', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
        }),
      ).not.toBeInTheDocument()
    })

    it('should reset an uncreated dialog draft after closing', async () => {
      const user = userEvent.setup()
      renderKnowledgeRetrieval()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      let dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      await user.click(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.custom',
        }),
      )
      await user.type(
        within(dialog).getByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
        }),
        'temporary query',
      )
      await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.add',
        }),
      )
      dialog = screen.getByRole('dialog', {
        name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.title',
      })
      expect(
        within(dialog).getByRole('radio', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.agent',
        }),
      ).toBeChecked()
      expect(
        within(dialog).queryByRole('textbox', {
          name: 'agentV2.agentDetail.configure.knowledgeRetrieval.dialog.query.customInputLabel',
        }),
      ).not.toBeInTheDocument()
    })
  })
})
