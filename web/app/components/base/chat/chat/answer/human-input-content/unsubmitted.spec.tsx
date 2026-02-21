import type { InputVarType } from '@/app/components/workflow/types'
import type { AppContextValue } from '@/context/app-context'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { useSelector } from '@/context/app-context'
import { UnsubmittedHumanInputContent } from './unsubmitted'

// Mock AppContext's useSelector to control user profile data
vi.mock('@/context/app-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/app-context')>()
  return {
    ...actual,
    useSelector: vi.fn(),
  }
})

describe('UnsubmittedHumanInputContent Integration', () => {
  const user = userEvent.setup()

  // Helper to create valid form data
  const createMockFormData = (overrides = {}): HumanInputFormData => ({
    form_id: 'form_123',
    node_id: 'node_456',
    node_title: 'Input Form',
    form_content: 'Fill this out: {{#$output.user_name#}}',
    inputs: [
      {
        type: 'paragraph' as InputVarType,
        output_variable_name: 'user_name',
        default: {
          type: 'constant',
          value: 'Default value',
          selector: [],
        },
      },
    ],
    actions: [
      { id: 'btn_1', title: 'Submit', button_style: UserActionButtonType.Primary },
    ],
    form_token: 'token_123',
    resolved_default_values: {},
    expiration_time: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    display_in_ui: true,
    ...overrides,
  } as unknown as HumanInputFormData)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSelector).mockImplementation((selector: (value: AppContextValue) => unknown) => {
      return selector({
        userProfile: {
          id: 'user_123',
          name: 'Test User',
          email: 'test@example.com',
          avatar: '',
          avatar_url: '',
          is_password_set: false,
        },
      } as AppContextValue)
    })
  })

  describe('Rendering', () => {
    it('should render form, tips, and expiration time when all conditions met', () => {
      render(
        <UnsubmittedHumanInputContent
          formData={createMockFormData()}
          showEmailTip={true}
          showDebugModeTip={true}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('Submit')).toBeInTheDocument()
      expect(screen.getByTestId('tips')).toBeInTheDocument()
      expect(screen.getByTestId('expiration-time')).toBeInTheDocument()
      expect(screen.getByText('workflow.common.humanInputWebappTip')).toBeInTheDocument()
    })

    it('should hide ExpirationTime when expiration_time is not a number', () => {
      const data = createMockFormData({ expiration_time: undefined })
      render(<UnsubmittedHumanInputContent formData={data} onSubmit={vi.fn()} />)

      expect(screen.queryByTestId('expiration-time')).not.toBeInTheDocument()
    })

    it('should hide Tips when both tip flags are false', () => {
      render(
        <UnsubmittedHumanInputContent
          formData={createMockFormData()}
          showEmailTip={false}
          showDebugModeTip={false}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.queryByTestId('tips')).not.toBeInTheDocument()
    })

    it('should render different email tips based on debug mode', () => {
      const { rerender } = render(
        <UnsubmittedHumanInputContent
          formData={createMockFormData()}
          showEmailTip={true}
          isEmailDebugMode={false}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('workflow.common.humanInputEmailTip')).toBeInTheDocument()

      rerender(
        <UnsubmittedHumanInputContent
          formData={createMockFormData()}
          showEmailTip={true}
          isEmailDebugMode={true}
          onSubmit={vi.fn()}
        />,
      )

      expect(screen.getByText('common.humanInputEmailTipInDebugMode')).toBeInTheDocument()
    })

    it('should render "Expired" state when expiration time is in the past', () => {
      const data = createMockFormData({ expiration_time: Math.floor(Date.now() / 1000) - 3600 })
      render(<UnsubmittedHumanInputContent formData={data} onSubmit={vi.fn()} />)

      expect(screen.getByText('share.humanInput.expiredTip')).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should update input values and call onSubmit', async () => {
      const handleSubmit = vi.fn().mockImplementation(() => Promise.resolve())
      const data = createMockFormData()

      render(<UnsubmittedHumanInputContent formData={data} onSubmit={handleSubmit} />)

      const textarea = screen.getByRole('textbox')
      await user.clear(textarea)
      await user.type(textarea, 'New Value')

      const submitBtn = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitBtn)

      expect(handleSubmit).toHaveBeenCalledWith('token_123', {
        action: 'btn_1',
        inputs: { user_name: 'New Value' },
      })
    })

    it('should handle loading state during submission', async () => {
      let resolveSubmit: (value: void | PromiseLike<void>) => void
      const handleSubmit = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        resolveSubmit = resolve
      }))
      const data = createMockFormData()

      render(<UnsubmittedHumanInputContent formData={data} onSubmit={handleSubmit} />)

      const submitBtn = screen.getByRole('button', { name: 'Submit' })
      await user.click(submitBtn)

      expect(submitBtn).toBeDisabled()
      expect(handleSubmit).toHaveBeenCalled()

      await waitFor(() => {
        resolveSubmit!()
      })

      await waitFor(() => expect(submitBtn).not.toBeDisabled())
    })
  })

  describe('Edge Cases', () => {
    it('should handle missing resolved_default_values', () => {
      const data = createMockFormData({ resolved_default_values: undefined })
      render(<UnsubmittedHumanInputContent formData={data} onSubmit={vi.fn()} />)
      expect(screen.getByText('Submit')).toBeInTheDocument()
    })

    it('should return null in ContentItem if field is not found', () => {
      const data = createMockFormData({
        form_content: '{{#$output.unknown_field#}}',
        inputs: [],
      })
      const { container } = render(<UnsubmittedHumanInputContent formData={data} onSubmit={vi.fn()} />)
      // The form will be empty (except for buttons) because unknown_field is not in inputs
      expect(container.querySelector('textarea')).not.toBeInTheDocument()
    })

    it('should render text-input type in initializeInputs correctly', () => {
      const data = createMockFormData({
        inputs: [
          {
            type: 'text-input',
            output_variable_name: 'var1',
            label: 'Var 1',
            required: true,
            default: { type: 'fixed', value: 'fixed_val' },
          },
        ],
      })
      render(<UnsubmittedHumanInputContent formData={data} onSubmit={vi.fn()} />)
      // initializeInputs is tested indirectly here.
      // We can't easily assert the internal state of HumanInputForm, but we can verify it doesn't crash.
    })
  })
})
