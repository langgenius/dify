import type { AnyFieldApi } from '@tanstack/react-form'
import type { FormSchema } from '@/app/components/base/form/types'
import { useForm } from '@tanstack/react-form'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import BaseField from '../base-field'

const mockDynamicOptions = vi.fn()
const mockCopy = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({ copy: mockCopy, copied: false }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: (...args: unknown[]) => mockDynamicOptions(...args),
}))

const renderBaseField = ({
  formSchema,
  defaultValues,
  fieldState,
  onChange,
  showCurrentValue = false,
}: {
  formSchema: FormSchema
  defaultValues?: Record<string, unknown>
  fieldState?: {
    validateStatus?: FormItemValidateStatusEnum
    errors?: string[]
    warnings?: string[]
  }
  onChange?: (field: string, value: unknown) => void
  showCurrentValue?: boolean
}) => {
  const TestComponent = () => {
    const form = useForm({
      defaultValues: defaultValues ?? { [formSchema.name]: '' },
      onSubmit: async () => {},
    })

    return (
      <>
        <form.Field name={formSchema.name}>
          {(field) => (
            <BaseField
              field={field as AnyFieldApi}
              formSchema={formSchema}
              fieldState={fieldState}
              onChange={onChange}
            />
          )}
        </form.Field>
        {showCurrentValue && (
          <form.Subscribe selector={(state) => state.values[formSchema.name]}>
            {(value) => <output aria-label="Field value">{String(value)}</output>}
          </form.Subscribe>
        )}
      </>
    )
  }

  return render(<TestComponent />)
}

describe('BaseField', () => {
  beforeEach(() => {
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    })
  })

  it.each([
    { type: FormTypeEnum.textInput, value: 'server-value', copied: 'server-value' },
    { type: FormTypeEnum.textNumber, value: 0, copied: '0' },
  ])(
    'copies the $type field value through its keyboard-accessible action',
    async ({ type, value, copied }) => {
      await renderBaseField({
        formSchema: { type, name: 'value', label: 'Value', required: false, showCopy: true },
        defaultValues: { value },
      })

      await page.getByLabelText('Value').click()
      await userEvent.tab()
      const copyButton = page.getByRole('button', { name: 'common.operation.copy' })
      await expect.element(copyButton).toHaveFocus()
      await userEvent.keyboard('{Enter}')

      expect(mockCopy).toHaveBeenCalledWith(copied)
      await expect.element(copyButton).toHaveFocus()
      await expect.element(page.getByLabelText('Value')).toHaveValue(String(value))
    },
  )

  it.each([FormTypeEnum.textInput, FormTypeEnum.secretInput, FormTypeEnum.textNumber])(
    'associates the visible label, description and required state for %s',
    async (type) => {
      await renderBaseField({
        formSchema: {
          type,
          name: 'credential',
          label: 'Credential',
          description: 'Use the workspace credential',
          required: true,
          options: [{ label: 'Primary', value: 'primary' }],
        },
      })
      const control = page.getByLabelText('Credential')
      await expect.element(control).toHaveAccessibleName('Credential')
      await expect.element(control).toHaveAccessibleDescription('Use the workspace credential')
      await expect.element(control).toBeRequired()
      await page.getByText('Credential').click()
      await expect.element(control).toHaveFocus()
    },
  )

  it.each([
    { type: FormTypeEnum.select, multiple: false },
    { type: FormTypeEnum.select, multiple: true },
    { type: FormTypeEnum.dynamicSelect, multiple: false },
    { type: FormTypeEnum.dynamicSelect, multiple: true },
  ])(
    'focuses the $type trigger from its label and supports keyboard selection (multiple: $multiple)',
    async ({ type, multiple }) => {
      const options = [{ label: 'Primary', value: 'primary' }]
      mockDynamicOptions.mockReturnValue({
        data: { options },
        isLoading: false,
        error: null,
      })
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
      await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()

      await userEvent.keyboard('{ArrowDown}')
      await expect.element(control).toHaveAttribute('aria-expanded', 'true')
      await expect.element(page.getByRole('option', { name: 'Primary' })).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect
        .element(page.getByRole('status', { name: 'Field value' }))
        .toHaveTextContent('primary')
    },
  )

  it('should render text input and propagate changes', async () => {
    const onChange = vi.fn()
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'title',
        label: 'Title',
        required: true,
      },
      defaultValues: { title: 'Hello' },
      onChange,
    })

    const input = page.getByRole('textbox', { name: 'Title' })
    await expect.element(input).toHaveValue('Hello')

    await input.fill('')
    await input.fill('Updated')
    expect(onChange).toHaveBeenCalledWith('title', 'Updated')
    await expect.element(input).toHaveValue('Updated')
  })

  it('should render only options that satisfy show_on conditions', async () => {
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

  it('should not render current select value when it is filtered out by show_on conditions', async () => {
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

    await expect.element(page.getByRole('combobox', { name: 'Mode' })).not.toHaveTextContent('beta')
    await expect
      .element(page.getByRole('combobox', { name: 'Mode' }))
      .toHaveTextContent('common.placeholder.input')
  })

  it('should render dynamic select loading state', async () => {
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    })

    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin',
        label: 'Plugin',
        required: false,
      },
      defaultValues: { plugin: '' },
    })

    await expect.element(page.getByText('common.dynamicSelect.loading')).toBeVisible()
  })

  it('should update value when users click a radio option', async () => {
    const onChange = vi.fn()
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
      onChange,
    })

    await page.getByText('Private').click()
    expect(onChange).toHaveBeenCalledWith('visibility', 'private')
    await expect.element(page.getByRole('radio', { name: 'Private' })).toBeChecked()
  })

  it.each([
    { type: FormTypeEnum.select, role: 'combobox' },
    { type: FormTypeEnum.radio, role: 'radiogroup' },
    { type: FormTypeEnum.checkbox, role: 'group' },
  ])(
    'associates $type validation and description with the named control',
    async ({ type, role }) => {
      await renderBaseField({
        formSchema: {
          type,
          name: 'access',
          label: 'Access level',
          description: 'Choose an access level',
          required: true,
          options: [{ label: 'Public', value: 'public' }],
        },
        defaultValues: { access: type === FormTypeEnum.checkbox ? [] : '' },
        fieldState: {
          validateStatus: FormItemValidateStatusEnum.Error,
          errors: ['Choose an option'],
        },
      })
      const control = page.getByRole(role, { name: 'Access level' })
      await expect.element(control).toHaveAttribute('aria-invalid', 'true')
      await expect
        .element(control)
        .toHaveAccessibleDescription('Choose an access level Choose an option')
    },
  )

  it('should show validation message when field state has an error', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'name',
        label: 'Name',
        required: false,
      },
      fieldState: {
        validateStatus: FormItemValidateStatusEnum.Error,
        errors: ['Name is required'],
      },
    })

    const input = page.getByRole('textbox', { name: 'Name' })
    await expect.element(input).toBeInvalid()
    await expect.element(input).toHaveAccessibleDescription('Name is required')
  })

  it('should render description and help link when provided', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'doc',
        label: 'Documentation',
        required: false,
        description: 'Read the description',
        url: 'https://example.com/help',
        help: 'Open help docs',
      },
      defaultValues: { doc: '' },
    })

    await expect.element(page.getByText('Read the description')).toBeVisible()
    await expect
      .element(page.getByRole('link', { name: 'Open help docs' }))
      .toHaveAttribute('href', 'https://example.com/help')
  })

  it('should render secret input with password type', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.secretInput,
        name: 'token',
        label: 'Token',
        required: false,
      },
      defaultValues: { token: 'abc' },
    })

    await expect.element(page.getByLabelText('Token')).toHaveAttribute('type', 'password')
  })

  it('keeps numeric edits, zero and an empty value distinct at the form boundary', async () => {
    const onChange = vi.fn()
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textNumber,
        name: 'count',
        label: 'Count',
        required: false,
      },
      defaultValues: { count: 7 },
      onChange,
    })

    const input = page.getByRole('textbox', { name: 'Count' })
    await expect.element(input).toHaveValue('7')
    await input.fill('')
    await input.fill('3.5')
    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith('count', 3.5)
    await input.fill('')
    await input.fill('0')
    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith('count', 0)
    await input.fill('')
    await userEvent.tab()
    expect(onChange).toHaveBeenLastCalledWith('count', null)
  })

  it('should render translated object label content', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'title_i18n',
        label: { en_US: 'Localized title', zh_Hans: '标题' },
        required: false,
      },
      defaultValues: { title_i18n: '' },
    })

    await expect.element(page.getByText('Localized title')).toBeVisible()
  })

  it('should render dynamic options and allow selecting one', async () => {
    mockDynamicOptions.mockReturnValue({
      data: {
        options: [{ label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' }],
      },
      isLoading: false,
      error: null,
    })

    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin_option',
        label: 'Plugin option',
        required: false,
      },
      defaultValues: { plugin_option: '' },
    })

    await page.getByRole('combobox', { name: 'Plugin option' }).click()
    await page.getByRole('option', { name: 'Option A' }).click()
    await expect
      .element(page.getByRole('combobox', { name: 'Plugin option' }))
      .toHaveTextContent('Option A')
  })

  it('should preserve multiple dynamic select values', async () => {
    mockDynamicOptions.mockReturnValue({
      data: {
        options: [
          { label: { en_US: 'Option A', zh_Hans: '选项A' }, value: 'a' },
          { label: { en_US: 'Option B', zh_Hans: '选项B' }, value: 'b' },
        ],
      },
      isLoading: false,
      error: null,
    })

    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'plugin_options',
        label: 'Plugin options',
        required: false,
        multiple: true,
      },
      defaultValues: { plugin_options: ['a'] },
      showCurrentValue: true,
    })

    await expect
      .element(page.getByRole('combobox', { name: 'Plugin options' }))
      .toHaveTextContent('common.dynamicSelect.selected:{"count":1}')

    await page.getByRole('combobox', { name: 'Plugin options' }).click()
    await page.getByRole('option', { name: 'Option B' }).click()

    await expect.element(page.getByRole('status', { name: 'Field value' })).toHaveTextContent('a,b')
  })

  it('should update boolean field when users choose false', async () => {
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

    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent('true')
    await page.getByText('False').click()
    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent('false')
  })

  it('should render warning message when field state has a warning', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'warning_field',
        label: 'Warning field',
        required: false,
      },
      fieldState: {
        validateStatus: FormItemValidateStatusEnum.Warning,
        warnings: ['This is a warning'],
      },
    })

    await expect.element(page.getByText('This is a warning')).toBeVisible()
  })

  it('should render infotip when tooltip content is provided', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'info',
        label: 'Info',
        required: false,
        tooltip: 'Extra info',
      },
    })

    await expect.element(page.getByText('Info')).toBeVisible()

    await page.getByRole('button', { name: 'Info' }).click()

    await expect.element(page.getByText('Extra info')).toBeVisible()
  })

  it('should render checkbox list and handle changes', async () => {
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
    })

    await expect.element(page.getByText('Feature A')).toBeVisible()
    await expect.element(page.getByText('Feature B')).toBeVisible()
    await page.getByText('Feature B').click()

    const checkboxB = page.getByRole('checkbox', { name: 'Feature B' })
    await expect.element(checkboxB).toHaveAttribute('aria-checked', 'true')
  })

  it('should handle dynamic select error state', async () => {
    mockDynamicOptions.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
    })
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'ds_error',
        label: 'DS Error',
        required: false,
      },
    })
    await page.getByRole('combobox', { name: 'DS Error' }).click()
    await expect.element(page.getByText('common.dynamicSelect.error')).toBeVisible()
    await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  })

  it('should handle dynamic select no data state', async () => {
    mockDynamicOptions.mockReturnValue({
      data: { options: [] },
      isLoading: false,
      error: null,
    })
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.dynamicSelect,
        name: 'ds_empty',
        label: 'DS Empty',
        required: false,
      },
    })
    await page.getByRole('combobox', { name: 'DS Empty' }).click()
    await expect.element(page.getByText('common.dynamicSelect.noData')).toBeVisible()
    await expect.element(page.getByRole('option')).not.toBeInTheDocument()
  })

  it.each([
    { type: FormTypeEnum.boolean, role: 'radio', label: 'False', value: true },
    { type: FormTypeEnum.checkbox, role: 'checkbox', label: 'Choice', value: [] },
  ])('keeps disabled $type values unchanged', async ({ type, role, label, value }) => {
    await renderBaseField({
      formSchema: {
        type,
        name: 'locked',
        label: 'Locked',
        required: false,
        disabled: true,
        options: [{ label: 'Choice', value: 'choice' }],
      },
      defaultValues: { locked: value },
      showCurrentValue: true,
    })
    const control = page.getByRole(role, { name: label })
    await expect.element(control).toBeDisabled()
    await expect.element(control).not.toBeChecked()
    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent(String(value))
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
