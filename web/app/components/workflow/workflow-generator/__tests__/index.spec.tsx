import { render, screen } from '@testing-library/react'
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
})
