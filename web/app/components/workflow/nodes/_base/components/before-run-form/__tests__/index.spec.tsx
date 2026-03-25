import type { Props as FormProps } from '../form'
import type { BeforeRunFormProps } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import BeforeRunForm from '../index'

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('../form', () => ({
  default: ({ values }: { values: Record<string, unknown> }) => <div>{Object.keys(values).join(',')}</div>,
}))

vi.mock('../panel-wrap', () => ({
  default: ({ children, nodeName }: { children: React.ReactNode, nodeName: string }) => (
    <div>
      <div>{nodeName}</div>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/human-input/components/single-run-form', () => ({
  default: ({ onSubmit, handleBack }: { onSubmit: (data: Record<string, unknown>) => void, handleBack?: () => void }) => (
    <div>
      <div>single-run-form</div>
      <button onClick={() => onSubmit({ approved: true })}>submit-generated-form</button>
      <button onClick={handleBack}>back-generated-form</button>
    </div>
  ),
}))

describe('BeforeRunForm', () => {
  const mockToastError = vi.mocked(toast.error)

  const createForm = (form: Partial<FormProps>): FormProps => ({
    inputs: [],
    values: {},
    onChange: vi.fn(),
    ...form,
  })
  const createProps = (props: Partial<BeforeRunFormProps>): BeforeRunFormProps => ({
    nodeName: 'Tool',
    onHide: vi.fn(),
    onRun: vi.fn(),
    onStop: vi.fn(),
    runningStatus: 'idle' as BeforeRunFormProps['runningStatus'],
    forms: [],
    filteredExistVarForms: [],
    existVarValuesInForms: [],
    ...props,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should auto run and render nothing when there are no filtered forms', () => {
    const onRun = vi.fn()
    const { container } = render(
      <BeforeRunForm
        {...createProps({
          onRun,
        })}
      />,
    )

    expect(onRun).toHaveBeenCalledWith({})
    expect(container).toBeEmptyDOMElement()
  })

  it('should show an error toast when required fields are missing', () => {
    render(
      <BeforeRunForm
        {...createProps({
          forms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: '' },
          })],
          filteredExistVarForms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: '' },
          })],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(mockToastError).toHaveBeenCalled()
  })

  it('should generate the human input form instead of running immediately', () => {
    const handleShowGeneratedForm = vi.fn()

    render(
      <BeforeRunForm
        {...createProps({
          nodeName: 'Human input',
          nodeType: BlockEnum.HumanInput,
          forms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          filteredExistVarForms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          existVarValuesInForms: [{}],
          handleShowGeneratedForm,
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.humanInput.singleRun.button' }))

    expect(handleShowGeneratedForm).toHaveBeenCalledWith({ query: 'hello' })
  })

  it('should render the generated human input form and submit it', async () => {
    const handleSubmitHumanInputForm = vi.fn().mockResolvedValue(undefined)
    const handleAfterHumanInputStepRun = vi.fn()
    const handleHideGeneratedForm = vi.fn()

    render(
      <BeforeRunForm
        {...createProps({
          nodeName: 'Human input',
          nodeType: BlockEnum.HumanInput,
          forms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          filteredExistVarForms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          existVarValuesInForms: [{}],
          showGeneratedForm: true,
          formData: {} as BeforeRunFormProps['formData'],
          handleSubmitHumanInputForm,
          handleAfterHumanInputStepRun,
          handleHideGeneratedForm,
        })}
      />,
    )

    expect(screen.getByText('single-run-form')).toBeInTheDocument()
    fireEvent.click(screen.getByText('submit-generated-form'))

    await Promise.resolve()
    expect(handleSubmitHumanInputForm).toHaveBeenCalledWith({ approved: true })
    expect(handleAfterHumanInputStepRun).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('back-generated-form'))
    expect(handleHideGeneratedForm).toHaveBeenCalledTimes(1)
  })

  it('should run immediately when the form is valid', () => {
    const onRun = vi.fn()

    render(
      <BeforeRunForm
        {...createProps({
          onRun,
          forms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          filteredExistVarForms: [createForm({
            inputs: [{ variable: 'query', label: 'Query', type: InputVarType.textInput, required: true }],
            values: { query: 'hello' },
          })],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(onRun).toHaveBeenCalledWith({ query: 'hello' })
  })

  it('should auto show the generated form when human input has no filtered vars', () => {
    const handleShowGeneratedForm = vi.fn()
    render(
      <BeforeRunForm
        {...createProps({
          nodeName: 'Human input',
          nodeType: BlockEnum.HumanInput,
          handleShowGeneratedForm,
        })}
      />,
    )

    expect(handleShowGeneratedForm).toHaveBeenCalledWith({})
    expect(screen.getByRole('button', { name: 'workflow.nodes.humanInput.singleRun.button' })).toBeInTheDocument()
  })

  it('should show an error toast when json input is invalid', () => {
    render(
      <BeforeRunForm
        {...createProps({
          forms: [createForm({
            inputs: [{ variable: 'payload', label: 'Payload', type: InputVarType.json, required: true }],
            values: { payload: '{' },
          })],
          filteredExistVarForms: [createForm({
            inputs: [{ variable: 'payload', label: 'Payload', type: InputVarType.json, required: true }],
            values: { payload: '{' },
          })],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(mockToastError).toHaveBeenCalled()
  })
})
