import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { useForm, useSelector } from '@tanstack/react-form'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import BaseForm from '../base-form'

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({
    data: undefined,
    isLoading: false,
    error: null,
  }),
}))

const baseSchemas: FormSchema[] = [
  {
    type: FormTypeEnum.textInput,
    name: 'kind',
    label: 'Kind',
    required: false,
    default: 'show',
  },
  {
    type: FormTypeEnum.textInput,
    name: 'title',
    label: 'Title',
    required: true,
    default: 'Initial title',
    show_on: [{ variable: 'kind', value: 'show' }],
  },
]

describe('BaseForm', () => {
  it('should render fields with default values from schema', () => {
    render(<BaseForm formSchemas={baseSchemas} />)

    expect(screen.getByDisplayValue('show'))!.toBeInTheDocument()
    expect(screen.getByDisplayValue('Initial title'))!.toBeInTheDocument()
  })

  it('should hide conditional fields when show_on conditions are not met', () => {
    render(
      <BaseForm
        formSchemas={baseSchemas}
        defaultValues={{ kind: 'hide', title: 'Hidden title' }}
      />,
    )

    expect(screen.getByDisplayValue('hide'))!.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Hidden title')).not.toBeInTheDocument()
  })

  it('should expose ref API for updating values and field states', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    expect(formRef.current).not.toBeNull()

    await act(async () => {
      formRef.current?.setFields([
        {
          name: 'title',
          value: 'Changed title',
          errors: ['Title is invalid'],
        },
      ])
    })

    expect(screen.getByDisplayValue('Changed title'))!.toBeInTheDocument()
    expect(screen.getByText('Title is invalid'))!.toBeInTheDocument()
    expect(formRef.current?.getFormValues({ needCheckValidatedValues: false })).toEqual({
      values: { kind: 'show', title: 'Changed title' },
      isCheckValidated: true,
    })
  })

  it('should derive warning status when setFields receives warnings only', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([
        {
          name: 'title',
          warnings: ['Title warning'],
        },
      ])
    })

    expect(screen.getByText('Title warning'))!.toBeInTheDocument()
  })

  it('uses the supplied form for editing and conditional field visibility', async () => {
    const user = userEvent.setup()
    const ExternalForm = () => {
      const form = useForm({ defaultValues: { kind: 'show', title: 'External title' } })
      const kind = useSelector(form.store, (state) => state.values.kind)
      return (
        <>
          <BaseForm formSchemas={baseSchemas} formFromProps={form} />
          <output>{kind}</output>
        </>
      )
    }
    render(<ExternalForm />)
    expect(screen.getByDisplayValue('External title')).toBeInTheDocument()
    await user.clear(screen.getByDisplayValue('show'))
    await user.type(screen.getAllByRole('textbox')[0]!, 'hide')
    expect(screen.getByRole('status')).toHaveTextContent('hide')
    expect(screen.queryByDisplayValue('External title')).not.toBeInTheDocument()
  })

  it('should handle setFields with explicit validateStatus', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([
        {
          name: 'kind',
          validateStatus: FormItemValidateStatusEnum.Error,
          errors: ['Explicit error'],
        },
      ])
    })
    expect(screen.getByText('Explicit error'))!.toBeInTheDocument()
  })

  it('should handle setFields with no value change', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([
        {
          name: 'kind',
          errors: ['Error only'],
        },
      ])
    })
    expect(screen.getByText('Error only'))!.toBeInTheDocument()
    expect(screen.getByDisplayValue('show')).toBeInTheDocument()
  })

  it('should handle submit without preventDefaultSubmit', async () => {
    const onSubmit = vi.fn()
    const { container } = render(<BaseForm formSchemas={baseSchemas} onSubmit={onSubmit} />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should handle preventDefaultSubmit', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <BaseForm formSchemas={baseSchemas} onSubmit={onSubmit} preventDefaultSubmit={true} />,
    )
    const event = new Event('submit', { cancelable: true, bubbles: true })
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent(form, event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should call onChange when field value changes', async () => {
    const onChange = vi.fn()
    render(<BaseForm formSchemas={baseSchemas} onChange={onChange} />)
    const input = screen.getByDisplayValue('show')
    await act(async () => {
      fireEvent.change(input, { target: { value: 'new-value' } })
    })
    expect(onChange).toHaveBeenCalledWith('kind', 'new-value')
  })

  it('should handle setFields with no status, errors, or warnings', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([
        {
          name: 'kind',
          value: 'new-show',
        },
      ])
    })
    expect(screen.getByDisplayValue('new-show'))!.toBeInTheDocument()
  })
})

it('preserves false and zero schema defaults in submitted values', () => {
  const ref = { current: null as FormRefObject | null }
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
  render(<BaseForm formSchemas={schemas} ref={ref} />)
  expect(screen.getByDisplayValue('Disabled by default')).toBeInTheDocument()
  expect(ref.current?.getFormValues({ needCheckValidatedValues: false })).toEqual({
    values: { enabled: false, count: 0, reason: 'Disabled by default' },
    isCheckValidated: true,
  })
})
