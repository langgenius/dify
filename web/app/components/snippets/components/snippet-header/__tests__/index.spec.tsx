import type { HeaderProps } from '@/app/components/workflow/header'
import type { SnippetDetailUIModel } from '@/models/snippet'
import { fireEvent, render, screen } from '@testing-library/react'
import SnippetHeader from '..'

vi.mock('@/app/components/workflow/header', () => ({
  default: (props: HeaderProps) => {
    const CustomRunMode = props.normal?.runAndHistoryProps?.components?.RunMode

    return (
      <div
        data-testid="workflow-header"
        data-show-env={String(props.normal?.controls?.showEnvButton ?? true)}
        data-show-global-variable={String(props.normal?.controls?.showGlobalVariableButton ?? true)}
        data-history-url={props.normal?.runAndHistoryProps?.viewHistoryProps?.historyUrl ?? ''}
      >
        {props.normal?.components?.left}
        {CustomRunMode && <CustomRunMode text={props.normal?.runAndHistoryProps?.runButtonText} />}
        {props.normal?.components?.middle}
      </div>
    )
  },
}))

describe('SnippetHeader', () => {
  const mockToggleInputPanel = vi.fn()
  const mockPublishMenuOpenChange = vi.fn()
  const mockPublish = vi.fn()
  const uiMeta: SnippetDetailUIModel = {
    inputFieldCount: 1,
    checklistCount: 2,
    autoSavedAt: 'Auto-saved · a few seconds ago',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Verifies the wrapper passes the expected workflow header configuration.
  describe('Rendering', () => {
    it('should configure workflow header slots and hide workflow-only controls', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          inputFieldCount={3}
          uiMeta={uiMeta}
          isPublishMenuOpen={false}
          isPublishing={false}
          onToggleInputPanel={mockToggleInputPanel}
          onPublishMenuOpenChange={mockPublishMenuOpenChange}
          onPublish={mockPublish}
        />,
      )

      const header = screen.getByTestId('workflow-header')
      expect(header).toHaveAttribute('data-show-env', 'false')
      expect(header).toHaveAttribute('data-show-global-variable', 'false')
      expect(header).toHaveAttribute('data-history-url', '/snippets/snippet-1/workflow-runs')
      expect(screen.getByRole('button', { name: /snippet\.inputFieldButton/i })).toHaveTextContent('3')
      expect(screen.getByRole('button', { name: /snippet\.publishButton/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /snippet\.testRunButton/i })).toBeInTheDocument()
    })
  })

  // Verifies forwarded callbacks still drive the snippet-specific controls.
  describe('User Interactions', () => {
    it('should invoke the snippet callbacks when input and publish trigger are clicked', () => {
      render(
        <SnippetHeader
          snippetId="snippet-1"
          inputFieldCount={1}
          uiMeta={uiMeta}
          isPublishMenuOpen={false}
          isPublishing={false}
          onToggleInputPanel={mockToggleInputPanel}
          onPublishMenuOpenChange={mockPublishMenuOpenChange}
          onPublish={mockPublish}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: /snippet\.inputFieldButton/i }))
      fireEvent.click(screen.getByRole('button', { name: /snippet\.publishButton/i }))

      expect(mockToggleInputPanel).toHaveBeenCalledTimes(1)
      expect(mockPublishMenuOpenChange).toHaveBeenCalledTimes(1)
      expect(mockPublishMenuOpenChange.mock.calls[0][0]).toBe(true)
    })
  })
})
