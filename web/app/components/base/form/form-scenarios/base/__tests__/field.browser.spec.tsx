import type { BaseConfiguration } from '../types'
import { useMemo } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
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
  await render(<Form />)
  await expect.element(page.getByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await page.getByRole('checkbox', { name: 'Advanced settings' }).click()
  await expect.element(page.getByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await page.getByRole('combobox', { name: 'Mode' }).click()
  await expect.element(page.getByRole('option', { name: 'Default' })).toHaveFocus()
  await userEvent.keyboard('{ArrowDown}')
  await expect.element(page.getByRole('option', { name: 'Custom' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
  const token = page.getByRole('textbox', { name: 'Token' })
  await expect.element(token).toHaveValue('saved-token')
  await token.fill('')
  await token.fill('new-token')
  await expect
    .element(page.getByRole('status', { name: 'Form values' }))
    .toHaveTextContent('{"enabled":true,"token":"new-token","mode":"custom"}')
  await page.getByRole('checkbox', { name: 'Advanced settings' }).click()
  await expect.element(page.getByRole('textbox', { name: 'Token' })).not.toBeInTheDocument()
  await page.getByRole('checkbox', { name: 'Advanced settings' }).click()
  await expect.element(page.getByRole('textbox', { name: 'Token' })).toHaveValue('new-token')
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
