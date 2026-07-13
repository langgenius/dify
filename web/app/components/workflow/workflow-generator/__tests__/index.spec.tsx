import type { WorkflowGenerateErrorResponse } from '@dify/contracts/api/console/workflow-generate/types.gen'
import type { GenerateWorkflowStreamCallbacks } from '@/service/workflow-generator'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WorkflowGeneratorModal from '../index'
import { useWorkflowGeneratorStore } from '../store'

const mockGenerateWorkflow = vi.fn()
const mockGenerateWorkflowStream = vi.fn()
const mockFetchSuggestions = vi.fn().mockResolvedValue({ suggestions: [] })

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: () => ({ data: { rbac_enabled: false } }),
  }
})

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: vi.fn(() => ({})),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({
    defaultModel: {
      model: 'gpt-4o',
      provider: { provider: 'openai' },
    },
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <div>model selector</div>,
  }),
)

vi.mock('@/app/components/workflow/workflow-preview', () => ({
  default: () => <div>workflow preview</div>,
}))

vi.mock('@/service/workflow-generator', () => ({
  fetchWorkflowInstructionSuggestions: (...args: unknown[]) => mockFetchSuggestions(...args),
  generateWorkflow: (...args: unknown[]) => mockGenerateWorkflow(...args),
  generateWorkflowStream: (...args: unknown[]) => mockGenerateWorkflowStream(...args),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: vi.fn(),
}))

describe('WorkflowGeneratorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
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
    it('should expose the dialog title and instruction label', async () => {
      render(<WorkflowGeneratorModal />)

      expect(screen.getByRole('dialog', { name: /workflowGenerator\.title/i })).toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: /workflowGenerator\.instruction/i }),
      ).toBeInTheDocument()
    })

    it('should keep the instruction field keyboard-operable', async () => {
      const user = userEvent.setup()
      render(<WorkflowGeneratorModal />)

      const instruction = screen.getByRole('textbox', {
        name: /workflowGenerator\.instruction/i,
      })
      await user.type(instruction, 'Summarize a URL')

      expect(instruction).toHaveValue('Summarize a URL')
    })
  })

  describe('Generation errors', () => {
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
})
