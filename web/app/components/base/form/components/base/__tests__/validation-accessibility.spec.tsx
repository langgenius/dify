import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import BaseForm from '../base-form'

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (content: Record<string, string>) => content.en_US ?? '',
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({ data: undefined, isLoading: false, error: null }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({ toast: { error: vi.fn() } }))

const requiredSchema = (label: string): FormSchema => ({
  name: 'token',
  label,
  type: FormTypeEnum.secretInput,
  required: true,
  description: 'Paste your API token',
  tooltip: 'Find this token in the provider settings',
  validators: {
    onMount: ({ value }: { value: unknown }) => (!value ? 'Token is required' : undefined),
    onChange: ({ value }: { value: unknown }) => (!value ? 'Token is required' : undefined),
  },
})

describe('BaseForm validation accessibility', () => {
  it('shows client validation again after editing clears a server error', async () => {
    const user = userEvent.setup()
    const ref = createRef<FormRefObject>()
    render(
      <>
        <BaseForm
          ref={ref}
          formSchemas={[requiredSchema('API token')]}
          onChange={(name) => ref.current?.setFields([{ name, errors: [] }])}
        />
        <button type="button" onClick={() => ref.current?.getFormValues({})}>
          Save credentials
        </button>
      </>,
    )
    const input = screen.getByLabelText('API token')
    await user.type(input, 'rejected-token')
    act(() => {
      ref.current?.setFields([{ name: 'token', errors: ['Token was rejected'] }])
    })
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription('Paste your API token Token was rejected')

    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'Save credentials' }))
    expect(input).toHaveFocus()
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription('Paste your API token Token is required')
    expect(screen.queryByText('Token was rejected')).not.toBeInTheDocument()

    await user.type(input, 'valid-token')
    expect(input).not.toBeInvalid()
    expect(input).toHaveAccessibleDescription('Paste your API token')
    expect(screen.queryByText('Token is required')).not.toBeInTheDocument()
  })

  it('focuses the invalid field in the submitting form and associates the error until corrected', async () => {
    const user = userEvent.setup()
    const ref = createRef<FormRefObject>()
    render(
      <>
        <BaseForm formSchemas={[requiredSchema('Other token')]} />
        <BaseForm ref={ref} formSchemas={[requiredSchema('API token')]} />
        <button type="button" onClick={() => ref.current?.getFormValues({})}>
          Save credentials
        </button>
      </>,
    )
    const input = screen.getByLabelText('API token')
    expect(input).not.toBeInvalid()
    await user.click(screen.getByRole('button', { name: 'Save credentials' }))
    expect(input).toHaveFocus()
    expect(input).toBeInvalid()
    expect(input).toHaveAccessibleDescription('Paste your API token Token is required')
    expect(screen.getByLabelText('Other token')).not.toBeInvalid()

    await user.type(input, 'valid-token')
    expect(input).not.toBeInvalid()
    expect(input).toHaveAccessibleDescription('Paste your API token')
    expect(screen.queryByText('Token is required')).not.toBeInTheDocument()
  })

  it('skips hidden field errors and focuses the first visible invalid field in schema order', async () => {
    const user = userEvent.setup()
    const ref = createRef<FormRefObject>()
    render(
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
    await user.click(screen.getByRole('button', { name: 'Save credentials' }))
    expect(screen.getByLabelText('Visible token')).toHaveFocus()
    expect(screen.queryByLabelText('Hidden token')).not.toBeInTheDocument()
  })
})
