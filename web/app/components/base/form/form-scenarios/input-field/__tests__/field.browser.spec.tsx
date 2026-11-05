import type { InputFieldConfiguration } from '../types'
import { useMemo } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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

  await render(<Form />)
  await page.getByRole('textbox', { name: /Name/ }).fill('Input name')
  expect(onChange).toHaveBeenLastCalledWith('Input name')
  await expect
    .element(page.getByRole('status', { name: 'Form values' }))
    .toHaveTextContent('{"name":"Input name","enabled":false,"description":"Saved description"}')
  await expect.element(page.getByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
  await userEvent.tab()
  await expect.element(page.getByRole('checkbox', { name: 'Enable description' })).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect
    .element(page.getByRole('textbox', { name: 'Description' }))
    .toHaveValue('Saved description')
  await userEvent.tab()
  await expect.element(page.getByRole('textbox', { name: 'Description' })).toHaveFocus()
  await userEvent.tab({ shift: true })
  await expect.element(page.getByRole('checkbox', { name: 'Enable description' })).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(page.getByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
