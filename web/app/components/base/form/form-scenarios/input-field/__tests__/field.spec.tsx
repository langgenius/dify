import type { InputFieldConfiguration } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { useAppForm } from '../../..'
import InputField from '../field'
import { InputFieldType } from '../types'

it('notifies a field listener with the edited value and reveals dependent configuration', async () => {
  const onChange = vi.fn()
  const initialData: Record<string, unknown> = {
    name: '',
    enabled: false,
    description: 'Saved description',
  }
  const configs: InputFieldConfiguration[] = [
    {
      type: InputFieldType.textInput,
      variable: 'name',
      label: 'Name',
      required: true,
      showConditions: [],
      listeners: { onChange: ({ value }) => onChange(value) },
    },
    {
      type: InputFieldType.checkbox,
      variable: 'enabled',
      label: 'Enable description',
      required: false,
      showConditions: [],
    },
    {
      type: InputFieldType.textInput,
      variable: 'description',
      label: 'Description',
      required: false,
      showConditions: [{ variable: 'enabled', value: true }],
    },
  ]
  function Form() {
    const form = useAppForm({ defaultValues: initialData })
    const fields = useMemo(() => configs.map((config) => InputField({ initialData, config })), [])
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
  const user = userEvent.setup()
  render(<Form />)
  await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Input name')
  expect(onChange).toHaveBeenLastCalledWith('Input name')
  expect(screen.getByRole('status', { name: 'Form values' })).toHaveTextContent(
    '"name":"Input name"',
  )
  expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Enable description' }))
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue('Saved description')
  await user.click(screen.getByRole('checkbox', { name: 'Enable description' }))
  expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
})
