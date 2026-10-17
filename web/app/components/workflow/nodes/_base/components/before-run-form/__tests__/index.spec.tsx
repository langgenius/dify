import type { ReactElement } from 'react'
import type { Props as FormProps } from '../form'
import type { BeforeRunFormProps } from '../index'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from 'reactflow'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import BeforeRunForm from '../index'

const render = (ui: ReactElement) => {
  const result = renderWorkflowComponent(<ReactFlowProvider>{ui}</ReactFlowProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) =>
      result.rerender(<ReactFlowProvider>{next}</ReactFlowProvider>),
  }
}

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
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

  it('should show an error toast when required fields are missing', async () => {
    render(
      <BeforeRunForm
        {...createProps({
          forms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: '' },
            }),
          ],
          filteredExistVarForms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: '' },
            }),
          ],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(mockToastError).toHaveBeenCalled()
  })

  it('should generate the human input form instead of running immediately', async () => {
    const handleShowGeneratedForm = vi.fn()

    render(
      <BeforeRunForm
        {...createProps({
          nodeName: 'Human input',
          nodeType: BlockEnum.HumanInput,
          forms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          filteredExistVarForms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          existVarValuesInForms: [{}],
          handleShowGeneratedForm,
        })}
      />,
    )

    await userEvent.setup().click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.singleRun.button',
      }),
    )

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
          forms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          filteredExistVarForms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          existVarValuesInForms: [{}],
          showGeneratedForm: true,
          formData: {
            form_id: 'form-1',
            node_id: 'human-1',
            node_title: 'Human input',
            form_content: 'Review this request',
            inputs: [],
            actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
            form_token: null,
            resolved_default_values: {},
            display_in_ui: true,
            expiration_time: null,
          },
          handleSubmitHumanInputForm,
          handleAfterHumanInputStepRun,
          handleHideGeneratedForm,
        })}
      />,
    )

    expect(await screen.findByText('Review this request')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() =>
      expect(handleSubmitHumanInputForm).toHaveBeenCalledWith({ inputs: {}, action: 'approve' }),
    )
    expect(handleAfterHumanInputStepRun).toHaveBeenCalledTimes(1)

    await userEvent
      .setup()
      .click(
        screen.getByRole('button', { name: 'workflowHumanInput.nodes.humanInput.singleRun.back' }),
      )
    expect(handleHideGeneratedForm).toHaveBeenCalledTimes(1)
  })

  it('should run immediately when the form is valid', async () => {
    const onRun = vi.fn()

    render(
      <BeforeRunForm
        {...createProps({
          onRun,
          forms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          filteredExistVarForms: [
            createForm({
              inputs: [
                { variable: 'query', label: 'Query', type: InputVarType.textInput, required: true },
              ],
              values: { query: 'hello' },
            }),
          ],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

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
    expect(
      screen.getByRole('button', { name: 'workflowHumanInput.nodes.humanInput.singleRun.button' }),
    ).toBeInTheDocument()
  })

  it('should show an error toast when json input is invalid', async () => {
    render(
      <BeforeRunForm
        {...createProps({
          forms: [
            createForm({
              inputs: [
                { variable: 'payload', label: 'Payload', type: InputVarType.json, required: true },
              ],
              values: { payload: '{' },
            }),
          ],
          filteredExistVarForms: [
            createForm({
              inputs: [
                { variable: 'payload', label: 'Payload', type: InputVarType.json, required: true },
              ],
              values: { payload: '{' },
            }),
          ],
          existVarValuesInForms: [{}],
        })}
      />,
    )

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'workflow.singleRun.startRun' }))

    expect(mockToastError).toHaveBeenCalled()
  })
})
