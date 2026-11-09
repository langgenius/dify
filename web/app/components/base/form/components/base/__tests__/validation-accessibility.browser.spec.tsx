import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { createRef } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import BaseForm from '../base-form'

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const requiredSchema = (label: string): FormSchema => ({
  name: 'token',
  label,
  type: FormTypeEnum.secretInput,
  required: true,
  description: 'Paste your API token',
  validators: {
    onMount: ({ value }: { value: unknown }) => (!value ? 'Token is required' : undefined),
    onChange: ({ value }: { value: unknown }) => (!value ? 'Token is required' : undefined),
  },
})

describe('BaseForm validation accessibility', () => {
  it('shows client validation again after editing clears a server error', async () => {
    const ref = createRef<FormRefObject>()
    await render(
      <>
        <BaseForm
          ref={ref}
          formSchemas={[requiredSchema('API token')]}
          onChange={(name) => ref.current?.setFields([{ name, errors: [] }])}
        />
        <button
          type="button"
          onClick={() =>
            ref.current?.setFields([{ name: 'token', errors: ['Token was rejected'] }])
          }
        >
          Apply server error
        </button>
        <button type="button" onClick={() => ref.current?.getFormValues({})}>
          Save credentials
        </button>
      </>,
    )
    const input = page.getByLabelText('API token')
    await input.fill('rejected-token')
    await page.getByRole('button', { name: 'Apply server error' }).click()
    await expect.element(input).toBeInvalid()
    await expect
      .element(input)
      .toHaveAccessibleDescription('Paste your API token Token was rejected')

    await input.fill('')
    await page.getByRole('button', { name: 'Save credentials' }).click()
    await expect.element(input).toHaveFocus()
    await expect.element(input).toBeInvalid()
    await expect
      .element(input)
      .toHaveAccessibleDescription('Paste your API token Token is required')
    await expect.element(page.getByText('Token was rejected')).not.toBeInTheDocument()

    await input.fill('valid-token')
    await expect.element(input).not.toBeInvalid()
    await expect.element(input).toHaveAccessibleDescription('Paste your API token')
    await expect.element(page.getByText('Token is required')).not.toBeInTheDocument()
  })

  it('focuses the invalid field in the submitting form and associates the error until corrected', async () => {
    const ref = createRef<FormRefObject>()
    await render(
      <>
        <BaseForm formSchemas={[requiredSchema('Other token')]} />
        <BaseForm ref={ref} formSchemas={[requiredSchema('API token')]} />
        <button type="button" onClick={() => ref.current?.getFormValues({})}>
          Save credentials
        </button>
      </>,
    )
    const input = page.getByLabelText('API token')
    await expect.element(input).not.toBeInvalid()
    await page.getByRole('button', { name: 'Save credentials' }).click()
    await expect.element(input).toHaveFocus()
    await expect.element(input).toBeInvalid()
    await expect
      .element(input)
      .toHaveAccessibleDescription('Paste your API token Token is required')
    await expect.element(page.getByLabelText('Other token')).not.toBeInvalid()

    await input.fill('valid-token')
    await expect.element(input).not.toBeInvalid()
    await expect.element(input).toHaveAccessibleDescription('Paste your API token')
    await expect.element(page.getByText('Token is required')).not.toBeInTheDocument()
  })

  it('skips hidden field errors and focuses the first visible invalid field in schema order', async () => {
    const ref = createRef<FormRefObject>()
    await render(
      <>
        <BaseForm
          ref={ref}
          defaultValues={{ enabled: 'no' }}
          formSchemas={[
            {
              ...requiredSchema('Hidden token'),
              name: 'hidden',
              show_on: [{ variable: 'enabled', value: 'yes' }],
            },
            requiredSchema('Visible token'),
            { ...requiredSchema('Later token'), name: 'later' },
          ]}
        />
        <button type="button" onClick={() => ref.current?.getFormValues({})}>
          Save credentials
        </button>
      </>,
    )
    await page.getByRole('button', { name: 'Save credentials' }).click()
    await expect.element(page.getByLabelText('Visible token')).toHaveFocus()
    await expect.element(page.getByLabelText('Hidden token')).not.toBeInTheDocument()
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
