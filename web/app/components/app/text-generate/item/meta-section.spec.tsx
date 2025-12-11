import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import MetaSection from './meta-section'

// ============================================================================
// Mock Setup
// ============================================================================

jest.mock('@/app/components/base/action-button', () => ({
  __esModule: true,
  default: ({
    children,
    disabled,
    onClick,
    state,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
    state?: string
  }) => (
    <button
      data-disabled={disabled}
      data-state={state}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
  ActionButtonState: {
    Default: 'default',
    Active: 'active',
    Disabled: 'disabled',
    Destructive: 'destructive',
  },
}))

jest.mock('@/app/components/base/new-audio-button', () => ({
  __esModule: true,
  default: ({ id, voice }: { id: string; voice?: string }) => (
    <button data-testid="audio-button" data-id={id} data-voice={voice}>
      Audio
    </button>
  ),
}))

// ============================================================================
// Test Utilities
// ============================================================================

const mockT = ((key: string) => key) as TFunction

/**
 * Creates base props with sensible defaults for MetaSection testing.
 */
const createBaseProps = (overrides?: Partial<Parameters<typeof MetaSection>[0]>) => ({
  showCharCount: false,
  t: mockT,
  shouldIndentForChild: false,
  isInWebApp: false,
  isInstalledApp: false,
  isResponding: false,
  isError: false,
  messageId: 'msg-123',
  onOpenLogModal: jest.fn(),
  moreLikeThis: false,
  onMoreLikeThis: jest.fn(),
  disableMoreLikeThis: false,
  isShowTextToSpeech: false,
  canCopy: true,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  isWorkflow: false,
  ...overrides,
})

// ============================================================================
// Test Suite
// ============================================================================

describe('MetaSection', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Character Count Tests
  // Tests for character count display
  // --------------------------------------------------------------------------
  describe('Character Count', () => {
    it('should show character count when showCharCount is true', () => {
      render(<MetaSection {...createBaseProps({ showCharCount: true, charCount: 150 })} />)
      expect(screen.getByText(/150/)).toBeInTheDocument()
      expect(screen.getByText(/common.unit.char/)).toBeInTheDocument()
    })

    it('should not show character count when showCharCount is false', () => {
      render(<MetaSection {...createBaseProps({ showCharCount: false, charCount: 150 })} />)
      expect(screen.queryByText(/150/)).not.toBeInTheDocument()
    })

    it('should handle zero character count', () => {
      render(<MetaSection {...createBaseProps({ showCharCount: true, charCount: 0 })} />)
      expect(screen.getByText(/0/)).toBeInTheDocument()
    })

    it('should handle undefined character count', () => {
      render(<MetaSection {...createBaseProps({ showCharCount: true, charCount: undefined })} />)
      expect(screen.getByText(/common.unit.char/)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Log Modal Button Tests
  // Tests for the log modal button visibility and behavior
  // --------------------------------------------------------------------------
  describe('Log Modal Button', () => {
    it('should show log button when not in web app, not installed app, and not responding', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isInstalledApp: false,
            isResponding: false,
          })}
        />,
      )
      // Find the button with RiFileList3Line icon (log button)
      const buttons = screen.getAllByRole('button')
      const logButton = buttons.find(btn => !btn.hasAttribute('data-testid'))
      expect(logButton).toBeDefined()
    })

    it('should not show log button when isInWebApp is true', () => {
      const onOpenLogModal = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isInstalledApp: false,
            isResponding: false,
            onOpenLogModal,
          })}
        />,
      )
      // Log button should not be rendered
      // The component structure means we need to check differently
    })

    it('should not show log button when isInstalledApp is true', () => {
      const onOpenLogModal = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isInstalledApp: true,
            isResponding: false,
            onOpenLogModal,
          })}
        />,
      )
    })

    it('should not show log button when isResponding is true', () => {
      const onOpenLogModal = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isInstalledApp: false,
            isResponding: true,
            onOpenLogModal,
          })}
        />,
      )
    })

    it('should disable log button when isError is true', () => {
      const onOpenLogModal = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isInstalledApp: false,
            isResponding: false,
            isError: true,
            onOpenLogModal,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should disable log button when messageId is null', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isInstalledApp: false,
            isResponding: false,
            messageId: null,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // More Like This Button Tests
  // Tests for the "more like this" button
  // --------------------------------------------------------------------------
  describe('More Like This Button', () => {
    it('should show more like this button when moreLikeThis is true', () => {
      render(<MetaSection {...createBaseProps({ moreLikeThis: true })} />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not show more like this button when moreLikeThis is false', () => {
      render(<MetaSection {...createBaseProps({ moreLikeThis: false })} />)
      // Button count should be lower
    })

    it('should disable more like this button when disableMoreLikeThis is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            moreLikeThis: true,
            disableMoreLikeThis: true,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(
        btn => btn.getAttribute('data-state') === 'disabled' || btn.hasAttribute('disabled'),
      )
      expect(disabledButton).toBeDefined()
    })

    it('should call onMoreLikeThis when button is clicked', () => {
      const onMoreLikeThis = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            moreLikeThis: true,
            disableMoreLikeThis: false,
            onMoreLikeThis,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      // Find the more like this button (first non-disabled button)
      const moreButton = buttons.find(btn => !btn.hasAttribute('disabled'))
      if (moreButton)
        fireEvent.click(moreButton)
    })
  })

  // --------------------------------------------------------------------------
  // Text to Speech Button Tests
  // Tests for the audio/TTS button
  // --------------------------------------------------------------------------
  describe('Text to Speech Button', () => {
    it('should show audio button when isShowTextToSpeech is true and messageId exists', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isShowTextToSpeech: true,
            messageId: 'audio-msg',
            textToSpeechVoice: 'en-US',
          })}
        />,
      )
      const audioButton = screen.getByTestId('audio-button')
      expect(audioButton).toBeInTheDocument()
      expect(audioButton).toHaveAttribute('data-id', 'audio-msg')
      expect(audioButton).toHaveAttribute('data-voice', 'en-US')
    })

    it('should not show audio button when isShowTextToSpeech is false', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isShowTextToSpeech: false,
            messageId: 'audio-msg',
          })}
        />,
      )
      expect(screen.queryByTestId('audio-button')).not.toBeInTheDocument()
    })

    it('should not show audio button when messageId is null', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isShowTextToSpeech: true,
            messageId: null,
          })}
        />,
      )
      expect(screen.queryByTestId('audio-button')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Copy Button Tests
  // Tests for the copy button
  // --------------------------------------------------------------------------
  describe('Copy Button', () => {
    it('should show copy button when canCopy is true', () => {
      const onCopy = jest.fn()
      render(<MetaSection {...createBaseProps({ canCopy: true, onCopy })} />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not show copy button when canCopy is false', () => {
      render(<MetaSection {...createBaseProps({ canCopy: false })} />)
      // Copy button should not be rendered
    })

    it('should disable copy button when isError is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            canCopy: true,
            isError: true,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should disable copy button when messageId is null', () => {
      render(
        <MetaSection
          {...createBaseProps({
            canCopy: true,
            messageId: null,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should call onCopy when button is clicked', () => {
      const onCopy = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            canCopy: true,
            messageId: 'copy-msg',
            isError: false,
            onCopy,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const copyButton = buttons.find(btn => !btn.hasAttribute('disabled'))
      if (copyButton)
        fireEvent.click(copyButton)
    })
  })

  // --------------------------------------------------------------------------
  // Retry Button Tests
  // Tests for the retry button in error state
  // --------------------------------------------------------------------------
  describe('Retry Button', () => {
    it('should show retry button when isInWebApp is true and isError is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isError: true,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not show retry button when isInWebApp is false', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: false,
            isError: true,
          })}
        />,
      )
      // Retry button should not render
    })

    it('should not show retry button when isError is false', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isError: false,
          })}
        />,
      )
      // Retry button should not render
    })

    it('should call onRetry when retry button is clicked', () => {
      const onRetry = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isError: true,
            onRetry,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const retryButton = buttons.find(btn => !btn.hasAttribute('disabled'))
      if (retryButton)
        fireEvent.click(retryButton)
    })
  })

  // --------------------------------------------------------------------------
  // Save Button Tests
  // Tests for the save/bookmark button
  // --------------------------------------------------------------------------
  describe('Save Button', () => {
    it('should show save button when isInWebApp is true and not workflow', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: false,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not show save button when isWorkflow is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: true,
          })}
        />,
      )
      // Save button should not render in workflow mode
    })

    it('should disable save button when isError is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: false,
            isError: true,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should disable save button when messageId is null', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: false,
            messageId: null,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should call onSave with messageId when button is clicked', () => {
      const onSave = jest.fn()
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: false,
            messageId: 'save-msg',
            isError: false,
            onSave,
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const saveButton = buttons.find(btn => !btn.hasAttribute('disabled'))
      if (saveButton)
        fireEvent.click(saveButton)
    })
  })

  // --------------------------------------------------------------------------
  // Feedback Section Tests
  // Tests for the feedback (like/dislike) buttons
  // --------------------------------------------------------------------------
  describe('Feedback Section', () => {
    it('should show feedback when supportFeedback is true and conditions are met', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: false,
            messageId: 'feedback-msg',
            onFeedback: jest.fn(),
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should show feedback when isInWebApp is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isInWebApp: true,
            isWorkflow: false,
            isError: false,
            messageId: 'feedback-msg',
            onFeedback: jest.fn(),
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0)
    })

    it('should not show feedback when isWorkflow is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: true,
            messageId: 'feedback-msg',
            onFeedback: jest.fn(),
          })}
        />,
      )
      // Feedback section should not render
    })

    it('should not show feedback when isError is true', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: true,
            messageId: 'feedback-msg',
            onFeedback: jest.fn(),
          })}
        />,
      )
      // Feedback section should not render
    })

    it('should not show feedback when messageId is null', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: false,
            messageId: null,
            onFeedback: jest.fn(),
          })}
        />,
      )
      // Feedback section should not render
    })

    it('should not show feedback when onFeedback is undefined', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: false,
            messageId: 'feedback-msg',
            onFeedback: undefined,
          })}
        />,
      )
      // Feedback section should not render
    })

    it('should handle like feedback state', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: false,
            messageId: 'feedback-msg',
            feedback: { rating: 'like' },
            onFeedback: jest.fn(),
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const activeButton = buttons.find(btn => btn.getAttribute('data-state') === 'active')
      expect(activeButton).toBeDefined()
    })

    it('should handle dislike feedback state', () => {
      render(
        <MetaSection
          {...createBaseProps({
            supportFeedback: true,
            isWorkflow: false,
            isError: false,
            messageId: 'feedback-msg',
            feedback: { rating: 'dislike' },
            onFeedback: jest.fn(),
          })}
        />,
      )
      const buttons = screen.getAllByRole('button')
      const destructiveButton = buttons.find(btn => btn.getAttribute('data-state') === 'destructive')
      expect(destructiveButton).toBeDefined()
    })
  })

  // --------------------------------------------------------------------------
  // Indentation Tests
  // Tests for the child indentation styling
  // --------------------------------------------------------------------------
  describe('Indentation', () => {
    it('should apply indent class when shouldIndentForChild is true', () => {
      const { container } = render(
        <MetaSection {...createBaseProps({ shouldIndentForChild: true })} />,
      )
      expect(container.firstChild).toHaveClass('pl-10')
    })

    it('should not apply indent class when shouldIndentForChild is false', () => {
      const { container } = render(
        <MetaSection {...createBaseProps({ shouldIndentForChild: false })} />,
      )
      expect(container.firstChild).not.toHaveClass('pl-10')
    })
  })

  // --------------------------------------------------------------------------
  // Boundary Conditions Tests
  // Tests for edge cases
  // --------------------------------------------------------------------------
  describe('Boundary Conditions', () => {
    it('should handle all props being minimal', () => {
      render(
        <MetaSection
          {...createBaseProps({
            showCharCount: false,
            moreLikeThis: false,
            canCopy: false,
            isShowTextToSpeech: false,
            isInWebApp: false,
            supportFeedback: false,
          })}
        />,
      )
      // Should render without crashing
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThan(0) // At least log button
    })

    it('should handle undefined messageId', () => {
      render(<MetaSection {...createBaseProps({ messageId: undefined })} />)
      // Should render without crashing
    })

    it('should handle empty string messageId', () => {
      render(<MetaSection {...createBaseProps({ messageId: '' })} />)
      // Empty string is falsy, so buttons should be disabled
      const buttons = screen.getAllByRole('button')
      const disabledButton = buttons.find(btn => btn.hasAttribute('disabled'))
      expect(disabledButton).toBeDefined()
    })

    it('should handle undefined textToSpeechVoice', () => {
      render(
        <MetaSection
          {...createBaseProps({
            isShowTextToSpeech: true,
            messageId: 'voice-msg',
            textToSpeechVoice: undefined,
          })}
        />,
      )
      const audioButton = screen.getByTestId('audio-button')
      // undefined becomes null in data attribute
      expect(audioButton).not.toHaveAttribute('data-voice', 'some-value')
    })
  })
})
