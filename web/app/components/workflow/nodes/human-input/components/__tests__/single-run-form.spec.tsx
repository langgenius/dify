import type { ReactNode } from 'react'
import type { HumanInputFormData } from '@/types/workflow'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { UserActionButtonType } from '../../types'
import SingleRunForm from '../single-run-form'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}))

vi.mock('@/app/components/base/chat/chat/answer/human-input-content/content-item', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

const createFormData = (overrides: Partial<HumanInputFormData> = {}): HumanInputFormData => ({
  form_id: 'form-1',
  node_id: 'human-1',
  node_title: 'Review',
  form_content: 'Please review {{#$output.review#}}',
  inputs: [{
    type: InputVarType.paragraph,
    output_variable_name: 'review',
    default: {
      selector: [],
      type: 'constant',
      value: 'initial review',
    },
  }],
  actions: [{
    id: 'approve',
    title: 'Approve',
    button_style: UserActionButtonType.Primary,
  }],
  form_token: 'token',
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: 0,
  ...overrides,
})

describe('SingleRunForm', () => {
  it('renders the back action as a named button and forwards clicks', async () => {
    const user = userEvent.setup()
    const handleBack = vi.fn()

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData()}
        showBackButton
        handleBack={handleBack}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'nodes.humanInput.singleRun.back' }))

    expect(handleBack).toHaveBeenCalledTimes(1)
  })

  it('submits the selected action with initialized inputs', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn().mockResolvedValue(undefined)

    render(
      <SingleRunForm
        nodeName="Review"
        data={createFormData()}
        onSubmit={onSubmit}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        inputs: { review: 'initial review' },
        action: 'approve',
      })
    })
  })
})
