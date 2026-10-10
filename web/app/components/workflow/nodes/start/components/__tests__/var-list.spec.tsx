import type { InputVar } from '@/app/components/workflow/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import VarList from '../var-list'

it('tabs to the reorder handle before the variable edit and remove actions', async () => {
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
  const handles = screen.getAllByRole('button', { pressed: false })

  await user.tab()
  expect(handles[0]).toHaveFocus()
  await user.tab()
  expect(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]).toHaveFocus()
  await user.tab()
  expect(screen.getAllByRole('button', { name: 'common.operation.remove' })[0]).toHaveFocus()
  await user.tab()
  expect(handles[1]).toHaveFocus()
})

const initialList: InputVar[] = ['alpha', 'beta'].map((variable) => ({
  variable,
  label: variable,
  type: InputVarType.textInput,
  required: false,
  max_length: 48,
}))

it('keeps a rejected edit, then saves the rename with its original key and starts a fresh next session', async () => {
  const onChange = vi.fn()
  function Owner() {
    const [list, setList] = useState(initialList)
    return (
      <VarList
        readonly={false}
        list={list}
        onChange={(next, moreInfo) => {
          onChange(next, moreInfo)
          setList(next)
        }}
      />
    )
  }
  const user = userEvent.setup()
  render(<Owner />)
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  const variable = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
  await user.clear(variable)
  await user.type(variable, 'beta')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onChange).not.toHaveBeenCalled()
  expect(variable).toHaveValue('beta')
  await user.clear(variable)
  await user.type(variable, 'renamed')
  const label = screen.getByRole('textbox', { name: 'appDebug.variableConfig.labelName' })
  await user.clear(label)
  await user.type(label, 'Changed label')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(onChange).toHaveBeenCalledExactlyOnceWith(
    expect.arrayContaining([
      expect.objectContaining({ variable: 'renamed', label: 'Changed label' }),
    ]),
    {
      index: 0,
      payload: { type: 'changeVarName', payload: { beforeKey: 'alpha', afterKey: 'renamed' } },
    },
  )
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  const reopened = screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })
  expect(reopened).toHaveValue('renamed')
  await user.clear(reopened)
  await user.type(reopened, 'discarded')
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  expect(screen.getByRole('textbox', { name: 'appDebug.variableConfig.varName' })).toHaveValue(
    'renamed',
  )
  expect(onChange).toHaveBeenCalledTimes(1)
})
