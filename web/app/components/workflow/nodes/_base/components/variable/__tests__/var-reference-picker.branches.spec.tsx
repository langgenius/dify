import type { ComponentProps } from 'react'
import type { FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { createNode, createStartNode, resetFixtureCounters } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { VarType as VarKindType } from '../../../../tool/types'
import VarReferencePicker from '../var-reference-picker'

const {
  mockFetchDynamicOptions,
} = vi.hoisted(() => ({
  mockFetchDynamicOptions: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useFetchDynamicOptions: () => ({
    mutateAsync: mockFetchDynamicOptions,
  }),
}))

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

vi.mock('../var-reference-popup', () => ({
  default: ({
    onChange,
  }: {
    onChange: (value: string[], item: { variable: string, type: VarType }) => void
  }) => (
    <div>
      <button onClick={() => onChange(['node-a', 'answer'], { variable: 'answer', type: VarType.string })}>select-normal</button>
      <button onClick={() => onChange(['node-a', 'sys.query'], { variable: 'sys.query', type: VarType.string })}>select-system</button>
    </div>
  ),
}))

describe('VarReferencePicker branches', () => {
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
    width: 120,
    height: 60,
    position: { x: 120, y: 80 },
    data: {
      type: BlockEnum.Code,
      title: 'Source Node',
      outputs: {
        answer: { type: VarType.string },
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
    ],
  }]

  const renderPicker = (props: Partial<ComponentProps<typeof VarReferencePicker>> = {}) => {
    const onChange = vi.fn()
    const onOpen = vi.fn()

    const result = renderWorkflowFlowComponent(
      <div id="workflow-container" style={{ width: 800, height: 600 }}>
        <VarReferencePicker
          nodeId="node-current"
          readonly={false}
          value={[]}
          onChange={onChange}
          onOpen={onOpen}
          availableNodes={[startNode, sourceNode, currentNode]}
          availableVars={availableVars}
          {...props}
        />
      </div>,
      {
        nodes: [startNode, sourceNode, currentNode],
        edges: [],
        hooksStoreProps: {},
        initialStoreState: {
          isWorkflowDataLoaded: true,
        },
      },
    )

    return { ...result, onChange, onOpen }
  }

  beforeEach(() => {
    resetFixtureCounters()
    vi.clearAllMocks()
    mockFetchDynamicOptions.mockResolvedValue({ options: [] as FormOption[] })
  })

  it('should toggle a custom trigger and call onOpen when opening the popup', async () => {
    const { onOpen } = renderPicker({
      trigger: <button>custom-trigger</button>,
    })

    fireEvent.click(screen.getByText('custom-trigger'))

    expect(await screen.findByText('select-normal')).toBeInTheDocument()
    await waitFor(() => {
      expect(onOpen).toHaveBeenCalled()
    })
  })

  it('should rewrite system selectors before forwarding the selection', async () => {
    const { onChange } = renderPicker()

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))
    fireEvent.click(await screen.findByText('select-system'))

    expect(onChange).toHaveBeenCalledWith(
      ['sys', 'query'],
      VarKindType.constant,
      expect.objectContaining({
        variable: 'sys.query',
        type: VarType.string,
      }),
    )
  })

  it('should clear variable-mode values to an empty selector array', () => {
    const { onChange } = renderPicker({
      defaultVarKindType: VarKindType.variable,
      isSupportConstantValue: true,
      value: ['node-a', 'answer'],
    })

    fireEvent.click(screen.getByRole('button', { name: /Clear|operation.clear/ }))

    expect(onChange).toHaveBeenCalledWith([], VarKindType.variable)
  })

  it('should jump to the selected node when ctrl-clicking the node name', () => {
    const { onChange } = renderPicker({
      value: ['node-a', 'answer'],
    })

    fireEvent.click(screen.getByText('Source Node'), { ctrlKey: true })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('should fetch dynamic options for supported constant fields', async () => {
    mockFetchDynamicOptions.mockResolvedValueOnce({
      options: [{
        value: 'dyn-1',
        label: { en_US: 'Dynamic 1', zh_Hans: '动态 1' },
        show_on: [],
      }],
    })

    renderPicker({
      currentProvider: { plugin_id: 'provider-1', name: 'provider-1' } as never,
      currentTool: { name: 'tool-1' } as never,
      isSupportConstantValue: true,
      schema: {
        variable: 'field',
        type: 'dynamic-select',
      } as never,
      value: 'dyn-1',
    })

    await waitFor(() => {
      expect(mockFetchDynamicOptions).toHaveBeenCalledTimes(1)
    })
  })

  it('should focus the hidden control input for supported constant values', async () => {
    const { container } = renderPicker({
      isSupportConstantValue: true,
      schema: {
        type: 'text-input',
      } as never,
      value: 'constant-value',
    })

    fireEvent.click(screen.getByTestId('var-reference-picker-trigger'))

    const hiddenInput = container.querySelector('input.sr-only') as HTMLInputElement
    await waitFor(() => {
      expect(document.activeElement).toBe(hiddenInput)
    })
  })

  it('should render tooltip branches for partial paths and invalid variables without changing behavior', () => {
    const objectVars: NodeOutPutVar[] = [{
      nodeId: 'node-a',
      title: 'Source Node',
      vars: [{
        variable: 'payload',
        type: VarType.object,
        children: [{ variable: 'child', type: VarType.string }],
      }],
    }]

    const { unmount } = renderPicker({
      availableVars: objectVars,
      value: ['node-a', 'payload', 'child'],
    })

    expect(screen.getByText('child')).toBeInTheDocument()
    unmount()

    renderPicker({
      value: ['missing-node', 'answer'],
    })

    expect(screen.getByText('answer')).toBeInTheDocument()
    expect(screen.getByTestId('var-reference-picker-error-icon')).toBeInTheDocument()
  })

  it('should not show an error icon for env variables that still exist in the workflow env list', () => {
    const envVars: NodeOutPutVar[] = [
      ...availableVars,
      {
        nodeId: 'env',
        title: 'ENVIRONMENT',
        vars: [{ variable: 'env.API_KEY', type: VarType.string }],
      },
    ]

    renderPicker({
      availableVars: envVars,
      value: ['env', 'API_KEY'],
    })

    expect(screen.getByText('API_KEY')).toBeInTheDocument()
    expect(screen.queryByTestId('var-reference-picker-error-icon')).not.toBeInTheDocument()
  })
})
