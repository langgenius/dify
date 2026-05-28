import type { ComponentProps } from 'react'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createNode, createStartNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import VarReferencePicker from '../var-reference-picker'

vi.mock('@/app/components/workflow/hooks', () => ({
  useIsChatMode: () => false,
  useWorkflow: () => ({
    getTreeLeafNodes: () => [],
    getNodeById: () => undefined,
    getBeforeNodesInSameBranchIncludeParent: () => [],
  }),
  useWorkflowVariables: () => ({
    getNodeAvailableVars: () => [],
    getCurrentVariableType: () => undefined,
  }),
}))

describe('VarReferencePicker', () => {
  const startNode = createStartNode({
    id: 'start-node',
    data: {
      title: 'Start',
      variables: [{
        variable: 'query',
        label: 'Query',
        type: InputVarType.textInput,
        required: false,
      }],
    },
  })
  const sourceNode = createNode({
    id: 'node-a',
    data: {
      type: BlockEnum.Code,
      title: 'Source Node',
      outputs: {
        answer: { type: VarType.string },
        payload: { type: VarType.object },
      },
    },
  })
  const currentNode = createNode({
    id: 'node-current',
    data: { type: BlockEnum.Code, title: 'Current Node' },
  })

  const availableVars: NodeOutPutVar[] = [{
    nodeId: 'node-a',
    title: 'Source Node',
    vars: [
      { variable: 'answer', type: VarType.string },
      {
        variable: 'payload',
        type: VarType.object,
        children: [{ variable: 'child', type: VarType.string }],
      },
    ],
  }]

  const renderPicker = (props: Partial<ComponentProps<typeof VarReferencePicker>> = {}) => {
    const onChange = vi.fn()

    const result = renderWorkflowFlowComponent(
      <div id="workflow-container">
        <VarReferencePicker
          nodeId="node-current"
          readonly={false}
          value={[]}
          onChange={onChange}
          availableNodes={[startNode, sourceNode, currentNode]}
          availableVars={availableVars}
          {...props}
        />
      </div>,
      {
        nodes: [startNode, sourceNode, currentNode],
        edges: [],
        hooksStoreProps: {},
      },
    )

    return { ...result, onChange }
  }

  beforeEach(() => {
    resetFixtureCounters()
  })

  it('should open the popup and select a variable from the available list', async () => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))

    fireEvent.click(await screen.findByText('answer'))

    expect(onChange).toHaveBeenCalledWith(
      ['node-a', 'answer'],
      'constant',
      expect.objectContaining({
        variable: 'answer',
        type: VarType.string,
      }),
    )
  })

  it('should render the selected node and variable name, then clear it', async () => {
    const { onChange } = renderPicker({
      value: ['node-a', 'answer'],
    })

    expect(screen.getByText('Source Node')).toBeInTheDocument()
    expect(screen.getByText('answer')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Clear|operation.clear/ }))
    expect(onChange).toHaveBeenCalledWith('', 'constant')
  })

  it('should show object variables in the popup and select the root object path', async () => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    fireEvent.click(await screen.findByText('payload'))

    expect(onChange).toHaveBeenCalledWith(
      ['node-a', 'payload'],
      'constant',
      expect.objectContaining({
        variable: 'payload',
        type: VarType.object,
      }),
    )
  })

  it('should render a placeholder and respect readonly mode', async () => {
    const { onChange } = renderPicker({
      readonly: true,
      placeholder: 'Pick a variable',
    })

    expect(screen.getByText('Pick a variable')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))

    await waitFor(() => {
      expect(screen.queryByText('answer')).not.toBeInTheDocument()
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
