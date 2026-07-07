import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import WorkflowHiddenInputFields from '../workflow-hidden-input-fields'

describe('WorkflowHiddenInputFields', () => {
  const onValueChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render a text input with label and placeholder', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'name',
          label: 'Full Name',
          type: InputVarType.textInput,
          hide: true,
          required: true,
        }]}
        values={{ name: 'Alice' }}
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByLabelText('Full Name')
    expect(input).toHaveValue('Alice')

    fireEvent.change(input, { target: { value: 'Bob' } })
    expect(onValueChange).toHaveBeenCalledWith('name', 'Bob')
  })

  it('should render a number input for number-typed variables', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'count',
          label: 'Count',
          type: InputVarType.number,
          hide: true,
          required: false,
        }]}
        values={{ count: '5' }}
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByLabelText('Count')
    expect(input).toHaveAttribute('type', 'number')

    fireEvent.change(input, { target: { value: '10' } })
    expect(onValueChange).toHaveBeenCalledWith('count', '10')
  })

  it('should render a checkbox input without a separate label element above', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'enabled',
          label: 'Enable Feature',
          type: InputVarType.checkbox,
          hide: true,
          required: false,
        }]}
        values={{ enabled: true }}
        onValueChange={onValueChange}
      />,
    )

    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
    expect(screen.getByText('Enable Feature')).toBeInTheDocument()

    fireEvent.click(checkbox)
    expect(onValueChange).toHaveBeenCalledWith('enabled', false)
  })

  it('should render a select dropdown for select-typed variables', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'color',
          label: 'Color',
          type: InputVarType.select,
          hide: true,
          required: false,
          options: ['red', 'green', 'blue'],
        }]}
        values={{ color: 'red' }}
        onValueChange={onValueChange}
      />,
    )

    expect(screen.getByRole('combobox', { name: 'Color' })).toBeInTheDocument()
  })

  it('should render a textarea for paragraph-typed variables', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'description',
          label: 'Description',
          type: InputVarType.paragraph,
          hide: true,
          required: false,
          max_length: 500,
        }]}
        values={{ description: 'Hello world' }}
        onValueChange={onValueChange}
      />,
    )

    const textarea = screen.getByPlaceholderText('Description')
    expect(textarea).toHaveValue('Hello world')

    fireEvent.change(textarea, { target: { value: 'Updated' } })
    expect(onValueChange).toHaveBeenCalledWith('description', 'Updated')
  })

  it('should render a textarea for json-typed variables', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'config',
          label: 'Config JSON',
          type: InputVarType.json,
          hide: true,
          required: false,
        }]}
        values={{ config: '{"key": "value"}' }}
        onValueChange={onValueChange}
      />,
    )

    const textarea = screen.getByPlaceholderText('Config JSON')
    expect(textarea).toHaveValue('{"key": "value"}')
  })

  it('should render a textarea for jsonObject-typed variables', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'schema',
          label: 'Schema',
          type: InputVarType.jsonObject,
          hide: true,
          required: false,
        }]}
        values={{ schema: '{}' }}
        onValueChange={onValueChange}
      />,
    )

    const textarea = screen.getByPlaceholderText('Schema')
    expect(textarea).toHaveValue('{}')
  })

  it('should use the variable key as label when label is not a string', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'my_var',
          label: { nodeType: 'start' as never, nodeName: 'Start', variable: 'my_var' },
          type: InputVarType.textInput,
          hide: true,
          required: false,
        }]}
        values={{ my_var: '' }}
        onValueChange={onValueChange}
      />,
    )

    expect(screen.getByText('my_var')).toBeInTheDocument()
  })

  it('should use the custom fieldIdPrefix for element ids', () => {
    const { container } = render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'token',
          label: 'Token',
          type: InputVarType.textInput,
          hide: true,
          required: false,
        }]}
        values={{ token: 'abc' }}
        onValueChange={onValueChange}
        fieldIdPrefix="custom-prefix"
      />,
    )

    expect(container.querySelector('#custom-prefix-token')).toBeInTheDocument()
  })

  it('should render empty string for non-string fieldValue in text inputs', () => {
    render(
      <WorkflowHiddenInputFields
        hiddenVariables={[{
          variable: 'flag',
          label: 'Flag',
          type: InputVarType.textInput,
          hide: true,
          required: false,
        }]}
        values={{ flag: true as never }}
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByLabelText('Flag')
    expect(input).toHaveValue('')
  })
})
