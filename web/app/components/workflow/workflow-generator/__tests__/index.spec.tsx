import type { WorkflowGenerateErrorResponse } from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { GenerateWorkflowStreamCallbacks } from '@/service/workflow-generator'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import {
  createCatalogModelFixture,
  createDefaultModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import WorkflowGeneratorModal from '../index'
import { useWorkflowGeneratorStore } from '../store'

const render = createNuqsTestRenderer((ui) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      models: [
        createCatalogModelFixture({
          model: 'gpt-4o',
          label: { en_US: 'GPT-4o' },
          model_properties: { mode: 'chat' },
        }),
      ],
    }),
  ])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.defaultModel.get.queryKey({
      input: { query: { model_type: 'llm' } },
    }),
    { data: createDefaultModelFixture({ model: 'gpt-4o' }) },
  )
  queryClient.setQueryDefaults(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.key(),
    { initialData: { data: [] } },
  )
  return renderWithConsoleQuery(ui, { queryClient })
})

const mockGenerateWorkflow = vi.fn()
const mockGenerateWorkflowStream = vi.fn()
const mockFetchSuggestions = vi.fn().mockResolvedValue({ suggestions: [] })
const mockFetchWorkflowDraft = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: () => <div>workflow preview</div>,
}))

vi.mock('@/service/workflow-generator', () => ({
  fetchWorkflowInstructionSuggestions: (...args: unknown[]) => mockFetchSuggestions(...args),
  generateWorkflow: (...args: unknown[]) => mockGenerateWorkflow(...args),
  generateWorkflowStream: (...args: unknown[]) => mockGenerateWorkflowStream(...args),
}))

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

describe('WorkflowGeneratorModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFetchSuggestions.mockResolvedValue({ suggestions: [] })
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('workflow-gen-workflow-') || key === 'workflow-gen-suggestions-workflow')
        sessionStorage.removeItem(key)
    }
    useWorkflowGeneratorStore.setState({
      isOpen: true,
      mode: 'workflow',
      intent: 'create',
      currentAppId: null,
      currentAppMode: null,
      initialInstruction: '',
      autoMode: false,
    })
  })

  describe('Accessibility', () => {
    it('should expose the dialog title and focus the labeled instruction', async () => {
      render(<WorkflowGeneratorModal />)

      expect(screen.getByRole('dialog', { name: /workflowGenerator\.title/i })).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /workflowGenerator\.instruction/i }),
      ).toBeInTheDocument()
      await waitFor(() =>
        expect(
          screen.getByRole('textbox', { name: /workflowGenerator\.instruction/i }),
        ).toHaveFocus(),
      )
    })

    it.each([{ isComposing: true }, { repeat: true }])(
      'should leave a composing or repeated submit key unclaimed (%j)',
      async (keyboardState) => {
        const user = userEvent.setup()
        render(<WorkflowGeneratorModal />)
        const instruction = screen.getByRole('textbox', {
          name: /workflowGenerator\.instruction/i,
        })
        await user.type(instruction, 'Summarize a URL')

        expect(
          fireEvent.keyDown(instruction, {
            key: 'Enter',
            ctrlKey: true,
            ...keyboardState,
          }),
        ).toBe(true)
        expect(mockGenerateWorkflowStream).not.toHaveBeenCalled()
      },
    )

    it('should generate from the instruction shortcut', async () => {
      const user = userEvent.setup()
      render(<WorkflowGeneratorModal />)

      const instruction = screen.getByRole('textbox', {
        name: /workflowGenerator\.instruction/i,
      })
      await user.type(instruction, 'Summarize a URL')
      await user.keyboard('{Control>}{Enter}{/Control}')

      await waitFor(() => expect(mockGenerateWorkflowStream).toHaveBeenCalledOnce())
    })
  })

  describe('Generation errors', () => {
    it('should surface an invalid schema error when generation returns an empty graph', async () => {
      const user = userEvent.setup()
      mockGenerateWorkflowStream.mockImplementation(
        (_body: unknown, callbacks: GenerateWorkflowStreamCallbacks) => {
          callbacks.onResult?.({
            graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          })
        },
      )
      render(<WorkflowGeneratorModal />)

      const instruction = screen.getByRole('textbox', {
        name: /workflowGenerator\.instruction/i,
      })
      await user.type(instruction, 'Build a researched answer')
      const generateButton = screen.getByRole('button', {
        name: /workflowGenerator\.generate/i,
      })
      await waitFor(() => expect(generateButton).toBeEnabled())
      await user.click(generateButton)

      expect(
        await screen.findByText(/workflowGenerator\.errors\.INVALID_SCHEMA/i),
      ).toBeInTheDocument()
    })

    it('should localize every structured generation error', async () => {
      const user = userEvent.setup()
      const errorCodes: WorkflowGenerateErrorResponse['code'][] = [
        'DANGLING_EDGE',
        'DUPLICATE_NODE_ID',
        'EMPTY_INSTRUCTION',
        'EMPTY_PLAN',
        'GRAPH_CYCLE',
        'INSTRUCTION_TOO_LONG',
        'INVALID_CONTAINER',
        'INVALID_JSON',
        'INVALID_SCHEMA',
        'MISSING_START',
        'MISSING_TERMINAL',
        'MODEL_ERROR',
        'UNKNOWN_NODE_REFERENCE',
        'UNKNOWN_TOOL',
        'UNRESOLVED_REFERENCE',
      ]
      let nextErrorIndex = 0
      mockGenerateWorkflowStream.mockImplementation(
        (_body: unknown, callbacks: GenerateWorkflowStreamCallbacks) => {
          const code = errorCodes[nextErrorIndex++]!
          callbacks.onResult?.({
            errors: [{ code, detail: `${code} detail` }],
            graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          })
        },
      )
      render(<WorkflowGeneratorModal />)

      const instruction = screen.getByRole('textbox', {
        name: /workflowGenerator\.instruction/i,
      })
      await user.type(instruction, 'Build a researched answer')
      const generateButton = screen.getByRole('button', {
        name: /workflowGenerator\.generate/i,
      })
      await waitFor(() => expect(generateButton).toBeEnabled())

      for (const [index, code] of errorCodes.entries()) {
        const action =
          index === 0
            ? generateButton
            : await screen.findByRole('button', {
                name: /workflowGenerator\.regenerate/i,
              })
        await user.click(action)

        expect(
          await screen.findByText(new RegExp(`workflowGenerator\\.errors\\.${code}`, 'i')),
        ).toBeInTheDocument()
      }
    })
  })

  describe('Generation result', () => {
    it('should include the current draft graph when refining a workflow', async () => {
      const user = userEvent.setup()
      const currentGraph = {
        nodes: [
          {
            id: 'start',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { type: 'start', title: 'Start' },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      mockFetchWorkflowDraft.mockResolvedValue({ graph: currentGraph })
      mockGenerateWorkflowStream.mockImplementation(
        (_body: unknown, callbacks: GenerateWorkflowStreamCallbacks) => {
          callbacks.onResult?.({
            errors: [{ code: 'MODEL_ERROR', detail: 'Stop after capturing the request' }],
            graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
          })
        },
      )
      useWorkflowGeneratorStore.setState({
        intent: 'refine',
        currentAppId: 'app-1',
        currentAppMode: 'workflow',
      })
      render(<WorkflowGeneratorModal />)

      await user.type(
        screen.getByRole('textbox', { name: /workflowGenerator\.instruction/i }),
        'Improve this workflow',
      )
      const generateButton = screen.getByRole('button', {
        name: /workflowGenerator\.generate/i,
      })
      await waitFor(() => expect(generateButton).toBeEnabled())
      await user.click(generateButton)

      await waitFor(() => {
        expect(mockGenerateWorkflowStream).toHaveBeenCalledWith(
          expect.objectContaining({ current_graph: currentGraph }),
          expect.any(Object),
        )
      })
    })

    it('should show the generated app identity', async () => {
      const user = userEvent.setup()
      mockGenerateWorkflowStream.mockImplementation(
        (_body: unknown, callbacks: GenerateWorkflowStreamCallbacks) => {
          callbacks.onResult?.({
            app_name: 'Research assistant',
            icon: '🧭',
            graph: {
              nodes: [
                {
                  id: 'start',
                  type: 'custom',
                  position: { x: 0, y: 0 },
                  data: { type: 'start', title: 'Start' },
                },
              ],
              edges: [],
              viewport: { x: 0, y: 0, zoom: 1 },
            },
          })
        },
      )
      render(<WorkflowGeneratorModal />)

      await user.type(
        screen.getByRole('textbox', { name: /workflowGenerator\.instruction/i }),
        'Build a researched answer',
      )
      const generateButton = screen.getByRole('button', {
        name: /workflowGenerator\.generate/i,
      })
      await waitFor(() => expect(generateButton).toBeEnabled())
      await user.click(generateButton)

      expect(await screen.findByText('🧭')).toBeInTheDocument()
      expect(screen.getByText('Research assistant')).toBeInTheDocument()
    })
  })
})
