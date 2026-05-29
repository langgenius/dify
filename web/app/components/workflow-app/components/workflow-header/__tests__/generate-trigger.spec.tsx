import type { App } from '@/types/app'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { AppModeEnum } from '@/types/app'
import GenerateTrigger from '../generate-trigger'

const mockOpenGenerator = vi.fn()
const mockUseNodesReadOnly = vi.fn()

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => mockUseNodesReadOnly(),
}))

vi.mock('@/app/components/workflow/workflow-generator/store', () => ({
  useWorkflowGeneratorStore: { getState: () => ({ openGenerator: mockOpenGenerator }) },
}))

const setAppDetail = (mode: AppModeEnum | undefined, id = 'app-1') => {
  useAppStore.setState({
    appDetail: mode === undefined
      ? undefined
      : ({ id, mode, name: 'Test', icon: '🤖', icon_background: '#FFF' } as unknown as App),
  })
}

describe('GenerateTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false })
    setAppDetail(undefined)
  })

  describe('rendering', () => {
    // The button is the AI shortcut for the two graph-based Studios. Anything
    // else (Chat, Completion, Agent-Chat, no app loaded) MUST not surface it
    // — those apps have no Workflow draft to overwrite.
    it('should render for Workflow apps', () => {
      setAppDetail(AppModeEnum.WORKFLOW)
      render(<GenerateTrigger />)
      expect(screen.getByRole('button', { name: /workflowGenerator\.studioButton/i })).toBeInTheDocument()
    })

    it('should render for Advanced-Chat (Chatflow) apps', () => {
      setAppDetail(AppModeEnum.ADVANCED_CHAT)
      render(<GenerateTrigger />)
      expect(screen.getByRole('button', { name: /workflowGenerator\.studioButton/i })).toBeInTheDocument()
    })

    it('should render nothing while appDetail is loading', () => {
      setAppDetail(undefined)
      const { container } = render(<GenerateTrigger />)
      expect(container.firstChild).toBeNull()
    })

    it.each([AppModeEnum.CHAT, AppModeEnum.COMPLETION, AppModeEnum.AGENT_CHAT])(
      'should render nothing for non-graph app mode %s',
      (mode) => {
        setAppDetail(mode)
        const { container } = render(<GenerateTrigger />)
        expect(container.firstChild).toBeNull()
      },
    )
  })

  describe('disabled state', () => {
    // Mirrors the Env / Global Var rule — never allow draft mutation while the
    // canvas is in read-only mode (running / viewing a published version).
    it('should be disabled when nodesReadOnly is true', () => {
      mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: true })
      setAppDetail(AppModeEnum.WORKFLOW)
      render(<GenerateTrigger />)
      expect(screen.getByRole('button', { name: /workflowGenerator\.studioButton/i })).toBeDisabled()
    })
  })

  describe('click', () => {
    // Studio button MUST lock the requested mode to the app's actual mode and
    // pass currentAppId so the modal renders the "Apply" (overwrite) flow.
    it('should open the generator with the current app id + mode locked', async () => {
      const user = userEvent.setup()
      setAppDetail(AppModeEnum.ADVANCED_CHAT, 'cf-99')
      render(<GenerateTrigger />)

      await user.click(screen.getByRole('button', { name: /workflowGenerator\.studioButton/i }))

      expect(mockOpenGenerator).toHaveBeenCalledWith({
        mode: 'advanced-chat',
        currentAppId: 'cf-99',
        currentAppMode: 'advanced-chat',
      })
    })
  })
})
