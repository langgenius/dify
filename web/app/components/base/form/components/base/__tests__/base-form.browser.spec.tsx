import type { ReactElement } from 'react'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { useForm, useSelector } from '@tanstack/react-form'
import { createRef } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render as renderBrowser } from 'vitest-browser-react'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import BaseForm from '../base-form'

const render = (ui: ReactElement) => {
  const { wrapper: Providers } = createConsoleQueryWrapper()
  return renderBrowser(<Providers>{ui}</Providers>)
}

const baseSchemas: FormSchema[] = [
  { type: FormTypeEnum.textInput, name: 'kind', label: 'Kind', required: false, default: 'show' },
  {
    type: FormTypeEnum.textInput,
    name: 'title',
    label: 'Title',
    required: true,
    default: 'Initial title',
    show_on: [{ variable: 'kind', value: 'show' }],
  },
]

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})

it('uses schema defaults and hides a conditional field when its controlling value changes', async () => {
  const onChange = vi.fn()
  await render(<BaseForm formSchemas={baseSchemas} onChange={onChange} />)
  await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Initial title')
  await page.getByRole('textbox', { name: 'Kind' }).fill('hide')
  await expect.element(page.getByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
  expect(onChange).toHaveBeenLastCalledWith('kind', 'hide')
})

it('omits conditional fields when supplied defaults do not match', async () => {
  await render(
    <BaseForm formSchemas={baseSchemas} defaultValues={{ kind: 'hide', title: 'Hidden title' }} />,
  )
  await expect.element(page.getByRole('textbox', { name: 'Kind' })).toHaveValue('hide')
  await expect.element(page.getByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
})

// setFields/getFormValues are BaseForm's public API used by credential request callers.
it.each([
  {
    name: 'server value and error',
    fields: [{ name: 'title', value: 'Changed title', errors: ['Title is invalid'] }],
    message: 'Title is invalid',
    title: 'Changed title',
  },
  {
    name: 'warning without a value change',
    fields: [{ name: 'title', warnings: ['Title warning'] }],
    message: 'Title warning',
    title: 'Initial title',
  },
  {
    name: 'explicit error status',
    fields: [
      {
        name: 'title',
        validateStatus: FormItemValidateStatusEnum.Error,
        errors: ['Explicit error'],
      },
    ],
    message: 'Explicit error',
    title: 'Initial title',
  },
  {
    name: 'error without a value change',
    fields: [{ name: 'title', errors: ['Error only'] }],
    message: 'Error only',
    title: 'Initial title',
  },
  {
    name: 'value without validation state',
    fields: [{ name: 'title', value: 'Changed title' }],
    message: undefined,
    title: 'Changed title',
  },
])(
  'applies $name through the caller and returns the displayed values',
  async ({ fields, message, title }) => {
    const ref = createRef<FormRefObject>()
    const saved = vi.fn()
    await render(
      <>
        <BaseForm ref={ref} formSchemas={baseSchemas} />
        <button type="button" onClick={() => ref.current?.setFields(fields)}>
          Apply response
        </button>
        <button
          type="button"
          onClick={() => saved(ref.current?.getFormValues({ needCheckValidatedValues: false }))}
        >
          Read values
        </button>
      </>,
    )
    await page.getByRole('button', { name: 'Apply response' }).click()
    await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue(title)
    if (message)
      await expect
        .element(page.getByRole('textbox', { name: 'Title' }))
        .toHaveAccessibleDescription(message)
    await page.getByRole('button', { name: 'Read values' }).click()
    expect(saved).toHaveBeenCalledWith({ values: { kind: 'show', title }, isCheckValidated: true })
  },
)

it('uses the supplied form for editing and conditional field visibility', async () => {
  function ExternalForm() {
    const form = useForm({ defaultValues: { kind: 'show', title: 'External title' } })
    const kind = useSelector(form.store, (state) => state.values.kind)
    return (
      <>
        <BaseForm formSchemas={baseSchemas} formFromProps={form} />
        <output>{kind}</output>
      </>
    )
  }
  await render(<ExternalForm />)
  await expect.element(page.getByRole('textbox', { name: 'Title' })).toHaveValue('External title')
  await page.getByRole('textbox', { name: 'Kind' }).fill('hide')
  await expect.element(page.getByRole('status')).toHaveTextContent('hide')
  await expect.element(page.getByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
})

it.each([false, true])(
  'delivers native Enter submission with preventDefaultSubmit=%s',
  async (preventDefaultSubmit) => {
    const submitted = vi.fn()
    await render(
      <BaseForm
        formSchemas={[baseSchemas[0]!]}
        preventDefaultSubmit={preventDefaultSubmit}
        onSubmit={(event) => {
          submitted({
            preventedByOwner: event.defaultPrevented,
            values: Object.fromEntries(new FormData(event.currentTarget)),
          })
          // The consumer prevents navigation when the BaseForm owner leaves that choice to it.
          event.preventDefault()
        }}
      />,
    )
    await page.getByRole('textbox', { name: 'Kind' }).fill('edited')
    await userEvent.keyboard('{Enter}')
    expect(submitted).toHaveBeenCalledExactlyOnceWith({
      preventedByOwner: preventDefaultSubmit,
      values: { kind: 'edited' },
    })
  },
)

it('preserves false and zero schema defaults in submitted values', async () => {
  const ref = createRef<FormRefObject>()
  const saved = vi.fn()
  const schemas: FormSchema[] = [
    {
      type: FormTypeEnum.boolean,
      name: 'enabled',
      label: 'Enabled',
      required: false,
      default: false,
    },
    { type: FormTypeEnum.textNumber, name: 'count', label: 'Count', required: false, default: 0 },
    {
      type: FormTypeEnum.textInput,
      name: 'reason',
      label: 'Reason',
      required: false,
      default: 'Disabled by default',
    },
  ]
  await render(
    <>
      <BaseForm formSchemas={schemas} ref={ref} />
      <button
        type="button"
        onClick={() => saved(ref.current?.getFormValues({ needCheckValidatedValues: false }))}
      >
        Save
      </button>
    </>,
  )
  await expect.element(page.getByRole('radio', { name: 'False' })).toBeChecked()
  await expect.element(page.getByRole('textbox', { name: 'Count' })).toHaveValue('0')
  await page.getByRole('button', { name: 'Save' }).click()
  expect(saved).toHaveBeenCalledWith({
    values: { enabled: false, count: 0, reason: 'Disabled by default' },
    isCheckValidated: true,
  })
})
