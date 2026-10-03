import type { HumanInputFilledFormData } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import HumanInputFilledFormList from '../human-input-filled-form-list'

it('keeps expansion with the same form when same-Tool submissions are reordered', async () => {
  const user = userEvent.setup()
  const first = {
    form_id: 'first',
    node_id: 'tool',
    node_title: 'First approval',
    rendered_content: 'First submitted content',
    action_id: 'approve',
    action_text: 'Approve',
  } satisfies HumanInputFilledFormData
  const second = {
    ...first,
    form_id: 'second',
    node_title: 'Second approval',
    rendered_content: 'Second submitted content',
  }
  const { rerender } = render(
    <HumanInputFilledFormList humanInputFilledFormDataList={[first, second]} />,
  )

  await user.click(screen.getByRole('button', { name: /First approval/ }))
  expect(await screen.findByText('First submitted content')).toBeInTheDocument()
  expect(screen.queryByText('Second submitted content')).not.toBeInTheDocument()

  rerender(<HumanInputFilledFormList humanInputFilledFormDataList={[second, first]} />)

  expect(screen.getByRole('button', { name: /First approval/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  expect(screen.getByText('First submitted content')).toBeInTheDocument()
  expect(screen.queryByText('Second submitted content')).not.toBeInTheDocument()
})
