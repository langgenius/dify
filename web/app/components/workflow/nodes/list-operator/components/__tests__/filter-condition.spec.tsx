import type { Condition } from '../../types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { TransferMethod } from '@/types/app'
import { BlockEnum, InputVarType, VarType } from '../../../../types'
import { ComparisonOperator } from '../../../if-else/types'
import FilterCondition from '../filter-condition'

const renderCondition = (ui: React.ReactElement) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedModelProviderQueries(queryClient, [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])

  const start = createStartNode({
    id: 'start',
    data: {
      title: 'File input',
      variables: [
        {
          variable: 'file_name',
          label: 'File name',
          type: InputVarType.textInput,
          required: true,
        },
      ],
    },
  })
  const code = createNode({
    id: 'code',
    data: {
      title: 'File stats',
      type: BlockEnum.Code,
      outputs: { file_size: { type: VarType.number, children: null } },
    },
  })
  const current = createNode({
    id: 'node-1',
    data: { title: 'List operator', type: BlockEnum.ListFilter },
  })

  return renderWorkflowFlowComponent(ui, {
    queryClient,
    nodes: [start, code, current],
    edges: [
      createEdge({
        source: start.id,
        target: code.id,
        data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
      }),
      createEdge({
        source: code.id,
        target: current.id,
        data: { sourceType: BlockEnum.Code, targetType: BlockEnum.ListFilter },
      }),
    ],
  })
}

describe('FilterCondition', () => {
  it('should render a select input for array-backed file conditions and update array values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderCondition(
      <FilterCondition
        condition={{
          key: 'type',
          comparison_operator: ComparisonOperator.in,
          value: ['document'],
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(
      await screen.findByRole('combobox', {
        name: 'workflow.nodes.listFilter.filterConditionComparisonValue',
      }),
    )
    await user.click(screen.getByText('workflowLogic.nodes.ifElse.optionName.image'))

    expect(onChange).toHaveBeenCalledWith({
      key: 'type',
      comparison_operator: ComparisonOperator.in,
      value: ['image'],
    })
  })

  it('should render a boolean value control for boolean variables', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderCondition(
      <FilterCondition
        condition={{
          key: 'enabled',
          comparison_operator: ComparisonOperator.equal,
          value: false,
        }}
        varType={VarType.boolean}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByText('True'))

    expect(onChange).toHaveBeenCalledWith({
      key: 'enabled',
      comparison_operator: ComparisonOperator.equal,
      value: true,
    })
  })

  it('should update a file name condition and accept only string variable references', async () => {
    const user = userEvent.setup()
    const initialCondition: Condition = {
      key: 'name',
      comparison_operator: ComparisonOperator.equal,
      value: 'draft',
    }
    const ControlledCondition = () => {
      const [condition, setCondition] = useState(initialCondition)
      return (
        <>
          <FilterCondition
            condition={condition}
            varType={VarType.file}
            onChange={setCondition}
            hasSubVariable={false}
            readOnly={false}
            nodeId="node-1"
          />
          <output aria-label="Saved condition">{JSON.stringify(condition)}</output>
        </>
      )
    }

    renderCondition(<ControlledCondition />)

    const editor = screen.getByRole('textbox')
    await waitFor(() => expect(editor).toHaveTextContent('draft'))
    await replacePromptEditorText(editor, 'draft next ')
    await user.click(editor)
    await user.type(editor, '/')

    expect(await screen.findByText('file_name')).toBeVisible()
    expect(screen.queryByText('file_size')).not.toBeInTheDocument()
    await user.click(screen.getByText('file_name'))

    await waitFor(() =>
      expect(
        JSON.parse(screen.getByRole('status', { name: 'Saved condition' }).textContent!),
      ).toEqual({
        key: 'name',
        comparison_operator: ComparisonOperator.equal,
        value: 'draft next {{#start.file_name#}}',
      }),
    )
  })

  it('should reset operator and value when the sub variable changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderCondition(
      <FilterCondition
        condition={{
          key: '',
          comparison_operator: ComparisonOperator.equal,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(
      await screen.findByRole('combobox', { name: 'workflow.nodes.listFilter.filterConditionKey' }),
    )
    await user.click(screen.getByRole('option', { name: 'size' }))

    expect(onChange).toHaveBeenCalledWith({
      key: 'size',
      comparison_operator: ComparisonOperator.largerThan,
      value: '',
    })
  })

  it('should render fallback inputs for unsupported keys and hide value inputs for no-value operators', async () => {
    const onChange = vi.fn()

    const { rerender } = renderCondition(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.equal,
          value: '',
        }}
        varType={VarType.number}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    const numberInput = screen.getByRole('spinbutton')
    fireEvent.change(numberInput, { target: { value: '42' } })

    expect(onChange).toHaveBeenLastCalledWith({
      key: 'custom_field',
      comparison_operator: ComparisonOperator.equal,
      value: '42',
    })

    rerender(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.empty,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('should build transfer-method options and keep empty select option lists stable for unsupported keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const { rerender } = renderCondition(
      <FilterCondition
        condition={{
          key: 'transfer_method',
          comparison_operator: ComparisonOperator.in,
          value: ['local_file'],
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('workflowLogic.nodes.ifElse.optionName.url'))
    expect(onChange).toHaveBeenCalledWith({
      key: 'transfer_method',
      comparison_operator: ComparisonOperator.in,
      value: [TransferMethod.remote_url],
    })

    rerender(
      <FilterCondition
        condition={{
          key: 'custom_field',
          comparison_operator: ComparisonOperator.in,
          value: '',
        }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable={false}
        readOnly={false}
        nodeId="node-1"
      />,
    )

    expect(screen.getByText('Select value')).toBeInTheDocument()
  })
  it('prevents boolean and sub-variable changes in read-only mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = renderCondition(
      <FilterCondition
        condition={{ key: 'enabled', comparison_operator: ComparisonOperator.equal, value: false }}
        varType={VarType.boolean}
        onChange={onChange}
        hasSubVariable={false}
        readOnly
        nodeId="node-1"
      />,
    )
    await user.click(screen.getByText('True'))
    expect(onChange).not.toHaveBeenCalled()
    rerender(
      <FilterCondition
        condition={{ key: 'size', comparison_operator: ComparisonOperator.largerThan, value: 5 }}
        varType={VarType.file}
        onChange={onChange}
        hasSubVariable
        readOnly
        nodeId="node-1"
      />,
    )
    const subVariable = await screen.findByRole('combobox', {
      name: 'workflow.nodes.listFilter.filterConditionKey',
    })
    expect(subVariable).toBeDisabled()
    await user.click(subVariable)
    expect(screen.queryByRole('option', { name: 'name' })).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
