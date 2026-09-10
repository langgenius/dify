import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import WorkflowGeneratorModal from '../index'
import { useWorkflowGeneratorStore } from '../store'

const mockGenerateWorkflow = vi.fn()
const mockGenerateWorkflowStream = vi.fn()
const mockFetchSuggestions = vi.fn().mockResolvedValue({ suggestions: [] })
const mockFetchWorkflowDraft = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: () => ({ data: { rbac_enabled: false } }),
  }
})

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

vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  useWorkflowGeneratorStore.setState({
    isOpen: false,
    mode: 'workflow',
    intent: 'create',
    currentAppId: null,
    currentAppMode: null,
    initialInstruction: '',
    autoMode: false,
  })
})

// The browser verifies focus across the real popup lifecycle and native keyboard events.
it('focuses the instruction on every open and restores the opener after Escape', async () => {
  const screen = await render(
    <>
      <button onClick={() => useWorkflowGeneratorStore.setState({ isOpen: true })}>
        Generate workflow
      </button>
      <WorkflowGeneratorModal />
    </>,
  )
  const trigger = screen.getByRole('button', { name: 'Generate workflow' })
  for (let opening = 0; opening < 2; opening++) {
    trigger.element().focus()
    await userEvent.keyboard('{Enter}')
    const instruction = screen.getByRole('textbox', { name: /workflowGenerator\.instruction$/ })
    await expect.element(instruction).toHaveFocus()
    await instruction.fill('Summarize a URL')
    await expect.element(instruction).toHaveValue('Summarize a URL')
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
  }
})
