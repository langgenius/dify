/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { QuestionClassifierNodeType, Topic } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { useEdgesInteractions } from '../../../hooks'
import AdvancedSetting from '../components/advanced-setting'
import ClassItem from '../components/class-item'
import ClassList from '../components/class-list'
import Node from '../node'
import Panel from '../panel'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({ title, value, onChange, onRemove, showRemove, headerClassName }: any) => (
    <div className={headerClassName}>
      <div>{typeof title === 'string' ? title : 'editor-title'}</div>
      <input value={value} onChange={event => onChange(event.target.value)} />
      {showRemove && <button type="button" onClick={onRemove}>remove-item</button>}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/memory-config', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange({ enabled: true })}>memory-config</button>,
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: vi.fn(() => ({
    availableVars: [{ variable: ['node-1', 'answer'], type: VarType.string }],
    availableNodesWithParent: [{ id: 'node-1', data: { title: 'Answer', type: BlockEnum.Answer } }],
  })),
}))

vi.mock('../../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks')>()
  return {
    ...actual,
    useEdgesInteractions: vi.fn(),
  }
})

vi.mock('@/app/components/workflow/nodes/_base/components/add-button', () => ({
  default: ({ text, onClick }: any) => <button type="button" onClick={onClick}>{text}</button>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({ defaultModel }: any) => <div>{defaultModel.provider}:{defaultModel.model}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  default: ({ value }: any) => <div>{value}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeSourceHandle: ({ handleId }: any) => <div>handle-{handleId}</div>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-parameter-modal', () => ({
  default: ({ setModel, onCompletionParamsChange }: any) => (
    <div>
      <button type="button" onClick={() => setModel({ provider: 'openai', name: 'gpt-4o' })}>set-model</button>
      <button type="button" onClick={() => onCompletionParamsChange({ temperature: 0.2 })}>set-params</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/collapse', () => ({
  FieldCollapse: ({ title, children }: any) => <div><div>{title}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => <div><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type }: any) => <div>{name}:{type}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/config-vision', () => ({
  default: ({ onEnabledChange, onConfigChange }: any) => (
    <div>
      <button type="button" onClick={() => onEnabledChange(true)}>vision-toggle</button>
      <button type="button" onClick={() => onConfigChange({ resolution: 'high' })}>vision-config</button>
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange }: any) => <button type="button" onClick={() => onChange(['node-1', 'query'])}>var-picker</button>,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseEdgesInteractions = vi.mocked(useEdgesInteractions)
const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)
const mockUseConfig = vi.mocked(useConfig)

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createData = (overrides: Partial<QuestionClassifierNodeType> = {}): QuestionClassifierNodeType => ({
  title: 'Question Classifier',
  desc: '',
  type: BlockEnum.QuestionClassifier,
  model: {
    provider: 'openai',
    name: 'gpt-4o',
    mode: 'chat',
    completion_params: {},
  },
  classes: [createTopic()],
  query_variable_selector: ['node-1', 'query'],
  instruction: 'Route by topic',
  memory: undefined,
  vision: {
    enabled: false,
  },
  ...overrides,
})

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  handleModelChanged: vi.fn(),
  isChatMode: true,
  isChatModel: true,
  handleCompletionParamsChange: vi.fn(),
  handleQueryVarChange: vi.fn(),
  filterVar: vi.fn(() => true),
  handleTopicsChange: vi.fn(),
  hasSetBlockStatus: { context: false, history: false, query: false },
  availableVars: [],
  availableNodesWithParent: [],
  availableVisionVars: [],
  handleInstructionChange: vi.fn(),
  handleMemoryChange: vi.fn(),
  isVisionModel: true,
  handleVisionResolutionEnabledChange: vi.fn(),
  handleVisionResolutionChange: vi.fn(),
  handleSortTopic: vi.fn(),
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

const renderPanel = (data: QuestionClassifierNodeType = createData()) => (
  render(<Panel id="node-1" data={data} panelProps={panelProps} />)
)

describe('question-classifier path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEdgesInteractions.mockReturnValue({
      handleEdgeDeleteByDeleteBranch: vi.fn(),
    } as unknown as ReturnType<typeof useEdgesInteractions>)
    mockUseTextGeneration.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
      textGenerationModelList: [{ provider: 'openai', model: 'gpt-4o', status: 'active' } as any],
      activeTextGenerationModelList: [{ provider: 'openai', model: 'gpt-4o', status: 'active' } as any],
    })
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  // The question classifier path should wire editor-based classes, model display, and panel controls together.
  describe('Path Integration', () => {
    it('should render advanced settings and memory config', async () => {
      const user = userEvent.setup()
      const onInstructionChange = vi.fn()
      const onMemoryChange = vi.fn()

      render(
        <AdvancedSetting
          instruction="Route by topic"
          onInstructionChange={onInstructionChange}
          hideMemorySetting={false}
          onMemoryChange={onMemoryChange}
          isChatModel
          isChatApp
          nodesOutputVars={[]}
          availableNodes={[]}
        />,
      )

      await user.type(screen.getByDisplayValue('Route by topic'), '!')
      await user.click(screen.getByText('memory-config'))

      expect(onInstructionChange).toHaveBeenCalled()
      expect(onMemoryChange).toHaveBeenCalledWith({ enabled: true })
    })

    it('should edit and remove a single class item', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onRemove = vi.fn()

      render(
        <ClassItem
          nodeId="node-1"
          payload={createTopic()}
          onChange={onChange}
          onRemove={onRemove}
          index={1}
          filterVar={() => true}
        />,
      )

      await user.type(screen.getByDisplayValue('Billing questions'), ' updated')
      await user.click(screen.getByText('remove-item'))

      expect(onChange).toHaveBeenCalled()
      expect(onRemove).toHaveBeenCalled()
    })

    it('should add classes and collapse the class list', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { container } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.questionClassifiers.addClass'))
      await user.click(screen.getByText('workflow.nodes.questionClassifiers.class'))
      expect(screen.queryByText('workflow.nodes.questionClassifiers.addClass')).not.toBeInTheDocument()
      await user.click(screen.getByText('workflow.nodes.questionClassifiers.class'))
      expect(screen.getByText('workflow.nodes.questionClassifiers.addClass')).toBeInTheDocument()
      expect(container.querySelector('.handle')).not.toBeNull()

      expect(onChange).toHaveBeenCalled()
    })

    it('should update and remove classes from the class list and delete the related edge branch', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const handleEdgeDeleteByDeleteBranch = vi.fn()
      mockUseEdgesInteractions.mockReturnValueOnce({
        handleEdgeDeleteByDeleteBranch,
      } as unknown as ReturnType<typeof useEdgesInteractions>)

      render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={onChange}
          filterVar={() => true}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('Billing questions'), { target: { value: 'Updated billing' } })
      await user.click(screen.getAllByText('remove-item')[0]!)

      expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ name: 'Updated billing' }),
      ]))
      expect(handleEdgeDeleteByDeleteBranch).toHaveBeenCalledWith('node-1', 'topic-1')
    })

    it('should disable dragging and hide the add button when the class list is readonly', () => {
      const { container } = render(
        <ClassList
          nodeId="node-1"
          list={[createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })]}
          onChange={vi.fn()}
          filterVar={() => true}
          readonly
        />,
      )

      expect(screen.queryByText('workflow.nodes.questionClassifiers.addClass')).not.toBeInTheDocument()
      expect(container.querySelector('.handle')).toBeNull()
    })

    it('should render the node model and output handles for each class', () => {
      renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData({ classes: [createTopic(), createTopic({ id: 'topic-2', name: 'Refunds' })] })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText('openai:gpt-4o')).toBeInTheDocument()
      expect(screen.getByText('Billing questions')).toBeInTheDocument()
      expect(screen.getByText('handle-topic-1')).toBeInTheDocument()
      expect(screen.getByText('handle-topic-2')).toBeInTheDocument()
    })

    it('should render the node when only classes are set and return null when both model and classes are missing', async () => {
      const user = userEvent.setup()
      const longName = 'L'.repeat(60)
      const { rerender } = renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData({
            model: { provider: '', name: '', mode: 'chat', completion_params: {} },
            classes: [createTopic({ id: 'topic-2', name: longName })],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText(`${longName.slice(0, 50)}...`)).toBeInTheDocument()
      await user.hover(screen.getByText(`${longName.slice(0, 50)}...`))
      expect(screen.getByText(longName)).toBeInTheDocument()

      rerender(
        <Node
          id="node-1"
          data={createData({
            model: { provider: '', name: '', mode: 'chat', completion_params: {} },
            classes: [],
          })}
          type="custom"
          selected={false}
          zIndex={1}
          xPos={0}
          yPos={0}
          dragging={false}
          isConnectable
        />,
      )

      expect(screen.queryByText('openai:gpt-4o')).not.toBeInTheDocument()
      expect(screen.queryByText(`${longName.slice(0, 50)}...`)).not.toBeInTheDocument()
    })

    it('should render the panel controls and output variables', async () => {
      const user = userEvent.setup()
      renderPanel()

      await user.click(screen.getByText('set-model'))
      await user.click(screen.getByText('set-params'))
      await user.click(screen.getAllByText('var-picker')[0]!)
      await user.click(screen.getByText('vision-toggle'))
      await user.click(screen.getByText('vision-config'))

      expect(screen.getByText('class_name:string')).toBeInTheDocument()
      expect(screen.getByText('usage:object')).toBeInTheDocument()
    })
  })
})
