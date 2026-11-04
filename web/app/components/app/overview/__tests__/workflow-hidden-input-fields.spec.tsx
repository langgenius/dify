import type { WorkflowHiddenStartVariable, WorkflowLaunchInputValue } from '../app-card-utils'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import WorkflowHiddenInputFields from '../workflow-hidden-input-fields'

function renderField(
  variable: WorkflowHiddenStartVariable,
  initialValue: WorkflowLaunchInputValue,
) {
  const onChange = vi.fn()
  function ControlledField() {
    const [values, setValues] = useState({ [variable.variable]: initialValue })
    return (
      <WorkflowHiddenInputFields
        hiddenVariables={[variable]}
        values={values}
        fieldIdPrefix="custom-launch"
        onValueChange={(key, value) => {
          onChange(key, value)
          setValues({ [key]: value })
        }}
      />
    )
  }
  render(<ControlledField />)
  return onChange
}

it.each([
  { type: InputVarType.textInput, initial: 'Alice', next: 'Bob' },
  { type: InputVarType.number, initial: '5', next: '10' },
  { type: InputVarType.paragraph, initial: 'Hello', next: 'Updated paragraph' },
  { type: InputVarType.json, initial: '{}', next: '{"key":"value"}' },
  { type: InputVarType.jsonObject, initial: '{}', next: '{"type":"object"}' },
])('edits a hidden $type value using its label', async ({ type, initial, next }) => {
  const user = userEvent.setup()
  const onChange = renderField(
    { variable: 'input', label: 'Launch input', type, hide: true, required: false },
    initial,
  )
  const input = screen.getByLabelText('Launch input')
  expect(input).toHaveValue(type === InputVarType.number ? Number(initial) : initial)
  await user.clear(input)
  await user.type(input, next.replaceAll('{', '{{'))
  expect(onChange).toHaveBeenLastCalledWith('input', next)
})

it('changes checkbox values as booleans', async () => {
  const user = userEvent.setup()
  const onChange = renderField(
    {
      variable: 'enabled',
      label: 'Enable feature',
      type: InputVarType.checkbox,
      hide: true,
      required: false,
    },
    true,
  )
  const checkbox = screen.getByRole('checkbox', { name: 'Enable feature' })
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  expect(onChange).toHaveBeenLastCalledWith('enabled', false)
  expect(checkbox).not.toBeChecked()
})

it('selects one of the configured hidden choices', async () => {
  const user = userEvent.setup()
  const onChange = renderField(
    {
      variable: 'color',
      label: 'Color',
      type: InputVarType.select,
      hide: true,
      required: false,
      options: ['red', 'green'],
    },
    'red',
  )
  await user.click(screen.getByRole('combobox', { name: 'Color' }))
  await user.click(await screen.findByRole('option', { name: 'green' }))
  expect(onChange).toHaveBeenLastCalledWith('color', 'green')
  expect(screen.getByRole('combobox', { name: 'Color' })).toHaveTextContent('green')
})

it('uses the variable key for structured labels and normalizes non-text initial values', () => {
  renderField(
    {
      variable: 'flag',
      label: { nodeType: BlockEnum.Start, nodeName: 'Start', variable: 'flag' },
      type: InputVarType.textInput,
      hide: true,
      required: false,
    },
    true,
  )
  expect(screen.getByLabelText('flag')).toHaveValue('')
})
