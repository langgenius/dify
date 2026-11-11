import { page } from 'vite-plus/test/browser'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderBaseField } from './base-field-test-env'

describe('BaseField semantics and guidance', () => {
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

  it('publishes an error through the named control', async () => {
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

  it('renders description and its help destination', async () => {
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

  it('uses a password input for a secret field', async () => {
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

  it('renders the current locale from a translated label object', async () => {
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

  it('publishes warning guidance without invalidating the field', async () => {
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

    const input = page.getByRole('textbox', { name: 'Warning field' })
    await expect.element(input).not.toBeInvalid()
    await expect.element(input).toHaveAccessibleDescription('This is a warning')
  })

  it('opens tooltip guidance from its named action', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'info',
        label: 'Info',
        required: false,
        tooltip: 'Extra info',
      },
    })

    await page.getByRole('button', { name: 'Info' }).click()
    await expect.element(page.getByText('Extra info')).toBeVisible()
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
