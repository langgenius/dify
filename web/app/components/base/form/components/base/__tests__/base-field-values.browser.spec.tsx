import { page, userEvent } from 'vite-plus/test/browser'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderBaseField } from './base-field-test-env'

const mockCopy = vi.fn()

// boundary: the system clipboard is outside Browser Mode; the real copy action remains rendered.
vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({ copy: mockCopy, copied: false }),
}))

describe('BaseField values', () => {
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

  it('keeps native text edits in the form owner', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textInput,
        name: 'title',
        label: 'Title',
        required: true,
      },
      defaultValues: { title: 'Hello' },
      showCurrentValue: true,
    })

    const input = page.getByRole('textbox', { name: 'Title' })
    await expect.element(input).toHaveValue('Hello')

    await input.fill('Updated')
    await expect.element(input).toHaveValue('Updated')
    await expect
      .element(page.getByRole('status', { name: 'Field value' }))
      .toHaveTextContent('Updated')
  })

  it('keeps numeric edits, zero and an empty value distinct at the form boundary', async () => {
    await renderBaseField({
      formSchema: {
        type: FormTypeEnum.textNumber,
        name: 'count',
        label: 'Count',
        required: false,
      },
      defaultValues: { count: 7 },
      showCurrentValue: true,
    })

    const input = page.getByRole('textbox', { name: 'Count' })
    const value = page.getByRole('status', { name: 'Field value' })
    await expect.element(input).toHaveValue('7')

    await input.fill('3.5')
    await userEvent.tab()
    await expect.element(value).toHaveTextContent('3.5')

    await input.fill('0')
    await userEvent.tab()
    await expect.element(value).toHaveTextContent('0')

    await input.fill('')
    await userEvent.tab()
    await expect.element(value).toHaveTextContent('null')
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
  mockCopy.mockClear()
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
