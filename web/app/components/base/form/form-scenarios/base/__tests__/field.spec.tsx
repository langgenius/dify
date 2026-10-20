import type { BaseConfiguration } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { useAppForm } from '../../..'
import BaseField from '../field'
import { BaseFieldType } from '../types'

const configs: BaseConfiguration[] = [
  {
    type: BaseFieldType.checkbox,
    variable: 'enabled',
    label: 'Advanced settings',
    required: false,
    showConditions: [],
  },
  {
    type: BaseFieldType.textInput,
    variable: 'token',
    label: 'Token',
    required: false,
    showConditions: [
      { variable: 'enabled', value: true },
      { variable: 'mode', value: 'custom' },
    ],
  },
  {
    type: BaseFieldType.select,
    variable: 'mode',
    label: 'Mode',
    required: false,
    showConditions: [],
    options: [
      { value: 'default', label: 'Default' },
      { value: 'custom', label: 'Custom' },
    ],
  },
]
const initialData: Record<string, unknown> = {
  enabled: false,
  token: 'saved-token',
  mode: 'default',
}
function Form() {
  const form = useAppForm({ defaultValues: initialData })
  const fields = useMemo(() => configs.map((config) => BaseField({ initialData, config })), [])
  return (
    <>
      {fields.map((Field, index) => (
        <Field key={configs[index]!.variable} form={form} />
      ))}
      <form.Subscribe selector={(state) => state.values}>
        {(values) => <output aria-label="Form values">{JSON.stringify(values)}</output>}
      </form.Subscribe>
    </>
  )
}

it('uses live field values to reveal a field only when all conditions match and preserves its value while hidden', async () => {
  const user = userEvent.setup()
  render(<Form />)
  expect(screen.queryByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Advanced settings' }))
  expect(screen.queryByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('combobox', { name: 'Mode' }))
  await user.click(await screen.findByRole('option', { name: 'Custom' }))
  const token = screen.getByRole('textbox', { name: 'Token' })
  expect(token).toHaveValue('saved-token')
  await user.clear(token)
  await user.type(token, 'new-token')
  expect(screen.getByRole('status', { name: 'Form values' })).toHaveTextContent(
    '"token":"new-token"',
  )
  await user.click(screen.getByRole('checkbox', { name: 'Advanced settings' }))
  expect(screen.queryByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Advanced settings' }))
  expect(screen.getByRole('textbox', { name: 'Token' })).toHaveValue('new-token')
})
