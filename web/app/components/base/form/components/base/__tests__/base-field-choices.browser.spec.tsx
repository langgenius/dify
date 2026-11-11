import { page, userEvent } from 'vite-plus/test/browser'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderBaseField } from './base-field-test-env'

describe('BaseField choice controls', () => {
  it.each([
    { type: FormTypeEnum.select, multiple: false },
    { type: FormTypeEnum.select, multiple: true },
  ])(
    'focuses the $type trigger from its label and supports keyboard selection (multiple: $multiple)',
    async ({ type, multiple }) => {
      const options = [{ label: 'Primary', value: 'primary' }]
      await renderBaseField({
        formSchema: {
          type,
          multiple,
          name: 'credential',
          label: 'Credential',
          description: 'Use the workspace credential',
          tooltip: 'Credential help',
          required: true,
          options,
        },
        defaultValues: { credential: multiple ? [] : '' },
        fieldState: {
          validateStatus: FormItemValidateStatusEnum.Error,
          errors: ['Choose a credential'],
        },
        showCurrentValue: true,
      })

      const control = page.getByRole('combobox', { name: 'Credential' })
      await expect
        .element(control)
        .toHaveAccessibleDescription('Use the workspace credential Choose a credential')
      await expect.element(control).toBeInvalid()
      await expect.element(control).toBeRequired()
      await expect.element(page.getByRole('button', { name: 'Credential' })).toBeVisible()
      await page.getByText('Credential').click()
      await expect.element(control).toHaveFocus()
      await expect.element(control).toHaveAttribute('aria-expanded', 'false')

      await userEvent.keyboard('{ArrowDown}')
      await expect.element(control).toHaveAttribute('aria-expanded', 'true')
      await expect.element(page.getByRole('option', { name: 'Primary' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect
        .element(page.getByRole('status', { name: 'Field value' }))
        .toHaveTextContent('primary')
    },
  )

  it('only offers options whose show_on conditions are satisfied', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.select,
        name: 'mode',
        label: 'Mode',
        required: false,
        options: [
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta', show_on: [{ variable: 'enabled', value: 'yes' }] },
        ],
      },
      defaultValues: { mode: 'alpha', enabled: 'no' },
    })

    await page.getByRole('combobox', { name: 'Mode' }).click()
    await expect.element(page.getByRole('option', { name: 'Alpha' })).toBeVisible()
    await expect.element(page.getByText('Beta')).not.toBeInTheDocument()
  })

  it('does not expose a selected value after show_on filters it out', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.select,
        name: 'mode',
        label: 'Mode',
        required: false,
        options: [
          { label: 'Alpha', value: 'alpha' },
          { label: 'Beta', value: 'beta', show_on: [{ variable: 'enabled', value: 'yes' }] },
        ],
      },
      defaultValues: { mode: 'beta', enabled: 'no' },
    })

    const control = page.getByRole('combobox', { name: 'Mode' })
    await expect.element(control).not.toHaveTextContent('beta')
    await expect.element(control).toHaveTextContent('common.placeholder.input')
  })

  it('applies a radio choice to the form owner', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.radio,
        name: 'visibility',
        label: 'Visibility',
        required: false,
        options: [
          { label: 'Public', value: 'public' },
          { label: 'Private', value: 'private' },
        ],
      },
      defaultValues: { visibility: 'public' },
      showCurrentValue: true,
    })

    await page.getByText('Private').click()
    await expect.element(page.getByRole('radio', { name: 'Private' })).toBeChecked()
    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent('private')
  })

  it('applies a false boolean choice to the form owner', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.boolean,
        name: 'enabled',
        label: 'Enabled',
        required: false,
      },
      defaultValues: { enabled: true },
      showCurrentValue: true,
    })

    await page.getByText('False').click()
    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent('false')
  })

  it('applies checkbox choices to the form owner', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.checkbox,
        name: 'features',
        label: 'Features',
        required: false,
        options: [
          { label: 'Feature A', value: 'a' },
          { label: 'Feature B', value: 'b' },
        ],
      },
      defaultValues: { features: ['a'] },
      showCurrentValue: true,
    })

    await page.getByText('Feature B').click()
    await expect.element(page.getByRole('checkbox', { name: 'Feature B' })).toBeChecked()
    await expect.element(page.getByRole('status', { name: 'Field value' })).toHaveTextContent('a,b')
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
