import type { AnyFieldApi, AnyFormApi } from '@tanstack/react-form'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import { useStore } from '@tanstack/react-form'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { FormItemValidateStatusEnum, FormTypeEnum } from '@/app/components/base/form/types'
import BaseForm from '../base-form'

vi.mock('@tanstack/react-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-form')>()
  return {
    ...actual,
    useStore: vi.fn((store, selector) => {
      // If a selector is provided, apply it to a mocked state or the store directly
      if (selector) {
        // If the store is a mock with state, use it; otherwise provide a default
        try {
          return selector(store?.state || { values: {} })
        }
        catch {
          return {}
        }
      }
      return store?.state?.values || {}
    }),
  }
})

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

  it('should prevent default submit behavior when preventDefaultSubmit is true', async () => {
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

    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement, {
        defaultPrevented: true,
      })
    })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should expose ref API for updating values and field states', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(
      <BaseForm
        formSchemas={baseSchemas}
        ref={formRef}
      />,
    )

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
    expect(formRef.current?.getForm()).toBeTruthy()
    expect(formRef.current?.getFormValues({})).toBeTruthy()
  })

  it('should derive warning status when setFields receives warnings only', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(
      <BaseForm
        formSchemas={baseSchemas}
        ref={formRef}
      />,
    )

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

  it('should use formFromProps if provided', () => {
    const mockState = { values: { kind: 'show' } }
    const mockStore = {
      state: mockState,
    }
    vi.mocked(useStore).mockReturnValueOnce(mockState.values)
    const mockForm = {
      store: mockStore,
      Field: ({ children, name }: { children: (field: AnyFieldApi) => React.ReactNode, name: string }) => children({
        name,
        state: { value: mockState.values[name as keyof typeof mockState.values], meta: { isTouched: false, errorMap: {} } },
        form: { store: mockStore },
      } as unknown as AnyFieldApi),
      setFieldValue: vi.fn(),
    }
    render(<BaseForm formSchemas={baseSchemas} formFromProps={mockForm as unknown as AnyFormApi} />)
    expect(screen.getByText('Kind'))!.toBeInTheDocument()
  })

  it('should handle setFields with explicit validateStatus', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([{
        name: 'kind',
        validateStatus: FormItemValidateStatusEnum.Error,
        errors: ['Explicit error'],
      }])
    })
    expect(screen.getByText('Explicit error'))!.toBeInTheDocument()
  })

  it('should handle setFields with no value change', async () => {
    const formRef = { current: null } as { current: FormRefObject | null }
    render(<BaseForm formSchemas={baseSchemas} ref={formRef} />)

    await act(async () => {
      formRef.current?.setFields([{
        name: 'kind',
        errors: ['Error only'],
      }])
    })
    expect(screen.getByText('Error only'))!.toBeInTheDocument()
  })

  it('should use default values from schema when defaultValues prop is missing', () => {
    render(<BaseForm formSchemas={baseSchemas} />)
    expect(screen.getByDisplayValue('show'))!.toBeInTheDocument()
  })

  it('should handle submit without preventDefaultSubmit', async () => {
    const onSubmit = vi.fn()
    const { container } = render(<BaseForm formSchemas={baseSchemas} onSubmit={onSubmit} />)
    await act(async () => {
      fireEvent.submit(container.querySelector('form') as HTMLFormElement)
    })
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should render nothing if field name does not match schema in renderField', () => {
    const mockState = { values: { unknown: 'value' } }
    const mockStore = {
      state: mockState,
    }
    vi.mocked(useStore).mockReturnValueOnce(mockState.values)
    const mockForm = {
      store: mockStore,
      Field: ({ children }: { children: (field: AnyFieldApi) => React.ReactNode }) => children({
        name: 'unknown', // field name not in baseSchemas
        state: { value: 'value', meta: { isTouched: false, errorMap: {} } },
        form: { store: mockStore },
      } as unknown as AnyFieldApi),
      setFieldValue: vi.fn(),
    }
    render(<BaseForm formSchemas={baseSchemas} formFromProps={mockForm as unknown as AnyFormApi} />)
    expect(screen.queryByText('Kind')).not.toBeInTheDocument()
  })

  it('should handle undefined formSchemas', () => {
    const { container } = render(<BaseForm formSchemas={undefined as unknown as FormSchema[]} />)
    expect(container)!.toBeEmptyDOMElement()
  })

  it('should handle empty array formSchemas', () => {
    const { container } = render(<BaseForm formSchemas={[]} />)
    expect(container)!.toBeEmptyDOMElement()
  })

  it('should fallback to schema class names if props are missing', () => {
    const schemaWithClasses: FormSchema[] = [{
      ...baseSchemas[0]!,
      fieldClassName: 'schema-field',
      labelClassName: 'schema-label',
    }]
    render(<BaseForm formSchemas={schemaWithClasses} />)
    expect(screen.getByText('Kind'))!.toHaveClass('schema-label')
    expect(screen.getByText('Kind').parentElement)!.toHaveClass('schema-field')
  })

  it('should handle preventDefaultSubmit', async () => {
    const onSubmit = vi.fn()
    const { container } = render(
      <BaseForm
        formSchemas={baseSchemas}
        onSubmit={onSubmit}
        preventDefaultSubmit={true}
      />,
    )
    const event = new Event('submit', { cancelable: true, bubbles: true })
    const spy = vi.spyOn(event, 'preventDefault')
    const form = container.querySelector('form') as HTMLFormElement
    await act(async () => {
      fireEvent(form, event)
    })
    expect(spy).toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalled()
  })

  it('should handle missing onSubmit prop', async () => {
    const { container } = render(<BaseForm formSchemas={baseSchemas} />)
    await act(async () => {
      expect(() => {
        fireEvent.submit(container.querySelector('form') as HTMLFormElement)
      }).not.toThrow()
    })
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
      formRef.current?.setFields([{
        name: 'kind',
        value: 'new-show',
      }])
    })
    expect(screen.getByDisplayValue('new-show'))!.toBeInTheDocument()
  })

  it('should handle schema without show_on in showOnValues', () => {
    const schemaNoShowOn: FormSchema[] = [{
      type: FormTypeEnum.textInput,
      name: 'test',
      label: 'Test',
      required: false,
    }]
    // Simply rendering should trigger showOnValues selector
    render(<BaseForm formSchemas={schemaNoShowOn} />)
    expect(screen.getByText('Test'))!.toBeInTheDocument()
  })

  it('should apply prop-based class names', () => {
    render(
      <BaseForm
        formSchemas={baseSchemas}
        fieldClassName="custom-field"
        labelClassName="custom-label"
      />,
    )
    const label = screen.getByText('Kind')
    expect(label)!.toHaveClass('custom-label')
  })
})
