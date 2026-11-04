import type { ModelParameterRule } from '../../declarations'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWorkflowEditor as render } from '@/test/workflow-editor'
import ParameterItem from '../parameter-item'

describe('ParameterItem', () => {
  const createRule = (overrides: Partial<ModelParameterRule> = {}): ModelParameterRule => ({
    name: 'temp',
    label: { en_US: 'Temperature', zh_Hans: 'Temperature' },
    type: 'float',
    help: { en_US: 'Help text', zh_Hans: 'Help text' },
    required: false,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { type: 'text', name: 'json_schema', label: 'JSON Schema' },
    { type: 'string', name: 'system_prompt', label: 'System prompt' },
  ])(
    'should name the $type input after its visible parameter label',
    async ({ type, name, label }) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <ParameterItem
          parameterRule={createRule({ type, name, label: { en_US: label, zh_Hans: label } })}
          value=""
          onChange={onChange}
        />,
      )

      await user.type(screen.getByRole('textbox', { name: label }), 'x')

      expect(onChange).toHaveBeenCalledWith('x')
      expect(screen.getByRole('switch', { name: label })).toBeChecked()
    },
  )

  it('should render float controls and clamp numeric input to max', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'float', min: 0, max: 1 })}
        value={0.7}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '1.4')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(1)
    expect(screen.getByRole('slider'))!.toBeInTheDocument()
  })

  it('should clamp float numeric input to min', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'float', min: 0.1, max: 1 })}
        value={0.7}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '0.05')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(0.1)
  })

  it('should render int controls and clamp numeric input', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'int', min: 0, max: 10 })}
        value={5}
        onChange={onChange}
      />,
    )
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '15')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(10)
    await user.clear(input)
    await user.type(input, '-5')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('should adjust step based on max for int type', () => {
    const { rerender } = render(
      <ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 50 })} value={5} />,
    )
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '1')

    rerender(
      <ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 500 })} value={50} />,
    )
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '10')

    rerender(
      <ParameterItem parameterRule={createRule({ type: 'int', min: 0, max: 2000 })} value={50} />,
    )
    expect(screen.getByRole('spinbutton'))!.toHaveAttribute('step', '100')
  })

  it('allows values above a configured minimum when no upper bound is supplied', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'int', min: 0 })}
        value={5}
        onChange={onChange}
      />,
    )
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '60')
    expect(onChange).toHaveBeenLastCalledWith(60)
  })

  it('selects an allowed string option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'string', options: ['a', 'b'] })}
        value="a"
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'b' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('adds a stop sequence on Tab without replacing existing sequences', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({
          type: 'tag',
          tagPlaceholder: { en_US: 'placeholder', zh_Hans: 'placeholder' },
        })}
        value={['a']}
        onChange={onChange}
      />,
    )
    expect(screen.getByText('placeholder'))!.toBeInTheDocument()
    await user.type(screen.getByRole('textbox'), 'STOP')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(['a', 'STOP'])
  })

  it('should render boolean radios and update value on click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({ type: 'boolean', default: false })}
        value={true}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('radio', { name: 'True' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: 'False' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('should propagate the first boolean selection for an unset optional parameter', () => {
    const onChange = vi.fn()
    render(
      <ParameterItem
        parameterRule={createRule({
          type: 'boolean',
          name: 'enable_thinking',
          label: { en_US: 'Thinking Mode', zh_Hans: 'Thinking Mode' },
          default: true,
        })}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('False'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('should name the optional switch after its parameter and toggle it off', async () => {
    const user = userEvent.setup()
    const onSwitch = vi.fn()
    render(<ParameterItem parameterRule={createRule()} value={0.7} onSwitch={onSwitch} />)
    await user.click(screen.getByRole('switch', { name: 'Temperature' }))
    expect(onSwitch).toHaveBeenCalledWith(false, 0.7)
  })

  it('should not render switch if required or name is stop', () => {
    const { rerender } = render(
      <ParameterItem parameterRule={createRule({ required: true })} value={1} />,
    )
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    rerender(
      <ParameterItem parameterRule={createRule({ name: 'stop', required: false })} value={1} />,
    )
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('should use default values if value is undefined', () => {
    const { rerender } = render(
      <ParameterItem parameterRule={createRule({ type: 'float', default: 0.5 })} />,
    )
    expect(screen.getByRole('spinbutton'))!.toHaveValue(0.5)

    rerender(<ParameterItem parameterRule={createRule({ type: 'string', default: 'hello' })} />)
    expect(screen.getByRole('textbox'))!.toHaveValue('hello')

    rerender(<ParameterItem parameterRule={createRule({ type: 'boolean', default: true })} />)
    expect(screen.getByRole('radio', { name: 'True' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'False' })).not.toBeChecked()

    rerender(<ParameterItem parameterRule={createRule({ type: 'float' })} />)
    expect(screen.getByRole('spinbutton'))!.toHaveValue(0)
  })

  it('should reset input to actual bound value on blur', async () => {
    const user = userEvent.setup()
    render(<ParameterItem parameterRule={createRule({ type: 'float', min: 0, max: 1 })} />)
    const input = screen.getByRole('spinbutton')
    await user.clear(input)
    await user.type(input, '5')
    await user.tab()
    expect(input)!.toHaveValue(1)
  })

  describe('workflow variable reference', () => {
    const mockNodesOutputVars: NodeOutPutVar[] = [{ nodeId: 'node1', title: 'LLM Node', vars: [] }]
    const mockAvailableNodes: Node[] = [
      {
        id: 'node1',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'LLM Node', desc: '', type: BlockEnum.LLM },
      },
      {
        id: 'start',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { title: 'Start', desc: '', type: BlockEnum.Start },
      },
    ]

    it.each(['string', 'text'])(
      'edits a workflow %s parameter with node references',
      async (type) => {
        const user = userEvent.setup()
        const onChange = vi.fn()
        render(
          <ParameterItem
            parameterRule={createRule({ type, name: 'system_prompt' })}
            value="hello {{#node1.output#}} {{#sys.query#}} "
            onChange={onChange}
            isInWorkflow
            nodesOutputVars={mockNodesOutputVars}
            availableNodes={mockAvailableNodes}
          />,
        )

        const editor = screen.getByRole('textbox')
        expect(await within(editor).findByText('LLM Node')).toBeVisible()
        expect(within(editor).getByText('output')).toBeVisible()
        expect(within(editor).getByText('workflow.blocks.start')).toBeVisible()

        await user.type(editor, '!')
        await waitFor(() =>
          expect(onChange).toHaveBeenCalledWith('hello {{#node1.output#}} {{#sys.query#}} !'),
        )
      },
    )
  })
})
