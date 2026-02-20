import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/base/form/types'
import BaseForm from './base-form'

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
  it('should render nothing when no schemas are provided', () => {
    const { container } = render(<BaseForm />)
    expect(container.firstChild).toBeNull()
  })

  it('should render fields with default values from schema', () => {
    render(<BaseForm formSchemas={baseSchemas} />)

    expect(screen.getByDisplayValue('show')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Initial title')).toBeInTheDocument()
  })

  it('should hide conditional fields when show_on conditions are not met', () => {
    render(
      <BaseForm
        formSchemas={baseSchemas}
        defaultValues={{ kind: 'hide', title: 'Hidden title' }}
      />,
    )

    expect(screen.getByDisplayValue('hide')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Hidden title')).not.toBeInTheDocument()
  })

  it('should prevent default submit behavior when preventDefaultSubmit is true', () => {
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => {
      expect(event.defaultPrevented).toBe(true)
    })
    const { container } = render(
      <BaseForm
        formSchemas={baseSchemas}
        onSubmit={onSubmit}
        preventDefaultSubmit
      />,
    )

    fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should expose ref API for updating values and field states', () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(
      <BaseForm
        formSchemas={baseSchemas}
        ref={formRef}
      />,
    )

    expect(formRef.current).not.toBeNull()

    act(() => {
      formRef.current?.setFields([
        {
          name: 'title',
          value: 'Changed title',
          errors: ['Title is invalid'],
        },
      ])
    })

    expect(screen.getByDisplayValue('Changed title')).toBeInTheDocument()
    expect(screen.getByText('Title is invalid')).toBeInTheDocument()
    expect(formRef.current?.getForm()).toBeTruthy()
    expect(formRef.current?.getFormValues({})).toBeTruthy()
  })

  it('should derive warning status when setFields receives warnings only', () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(
      <BaseForm
        formSchemas={baseSchemas}
        ref={formRef}
      />,
    )

    act(() => {
      formRef.current?.setFields([
        {
          name: 'title',
          warnings: ['Title warning'],
        },
      ])
    })

    expect(screen.getByText('Title warning')).toBeInTheDocument()
  })
})
