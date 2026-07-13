import type { HumanInputFilledFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import HumanInputFilledFormList from '../human-input-filled-form-list'

/**
 * Type-safe factory.
 * Forces test data to match real interface.
 */
const createFormData = (
  overrides: Partial<HumanInputFilledFormData> = {},
): HumanInputFilledFormData => ({
  node_id: 'node-1',
  node_title: 'Node Title',
  rendered_content: 'fallback content',
  action_id: 'approve',
  action_text: 'Approve',
  submitted_data: {
    summary: 'Approved',
  },

  ...overrides,
})

describe('HumanInputFilledFormList', () => {
  it('renders nothing when list is empty', () => {
    render(<HumanInputFilledFormList humanInputFilledFormDataList={[]} />)

    expect(screen.queryByText('Node Title')).not.toBeInTheDocument()
  })

  it('renders one form item', async () => {
    const user = userEvent.setup()
    const data = [createFormData()]

    render(<HumanInputFilledFormList humanInputFilledFormDataList={data} />)

    expect(screen.getByText('Node Title')).toBeInTheDocument()
    await user.click(screen.getByTestId('expand-icon'))
    expect(screen.getByTestId('submitted-field-summary')).toHaveTextContent('Approved')
  })

  it('renders multiple form items', () => {
    const data = [
      createFormData({ node_id: '1', node_title: 'First' }),
      createFormData({ node_id: '2', node_title: 'Second' }),
    ]

    render(<HumanInputFilledFormList humanInputFilledFormDataList={data} />)

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('renders wrapper container', () => {
    const { container } = render(
      <HumanInputFilledFormList humanInputFilledFormDataList={[createFormData()]} />,
    )

    expect(container.firstChild).toHaveClass('flex')
    expect(container.firstChild).toHaveClass('flex-col')
  })
})
