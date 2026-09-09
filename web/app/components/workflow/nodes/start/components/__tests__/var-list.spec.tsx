import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import VarList from '../var-list'

vi.mock('@/app/components/app/configuration/config-var/config-modal', () => ({
  default: () => null,
}))

it('tabs to the reorder handle before the hovered variable edit and remove actions', async () => {
  const user = userEvent.setup()
  render(
    <VarList
      readonly={false}
      list={['alpha', 'beta'].map((variable) => ({
        variable,
        label: variable,
        type: InputVarType.textInput,
        required: false,
      }))}
      onChange={vi.fn()}
    />,
  )
  await user.hover(screen.getAllByText('alpha')[0]!)
  const handles = screen.getAllByRole('button', { pressed: false })

  await user.tab()
  expect(handles[0]).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.edit' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'common.operation.remove' })).toHaveFocus()
  await user.tab()
  expect(handles[1]).toHaveFocus()
})
