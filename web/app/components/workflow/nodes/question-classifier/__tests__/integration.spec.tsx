import type { ComponentProps } from 'react'
import type { QuestionClassifierNodeType } from '../types'
import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { useEdgesInteractions } from '../../../hooks/use-edges-interactions'
import ClassList from '../../_base/components/branch-list/class-list'
import AdvancedSetting from '../components/advanced-setting'
import Node from '../node'

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({
    title,
    value,
    onChange,
    onRemove,
    showRemove,
    readOnly,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/prompt/editor').default
  >) => (
    <div>
      <div>{title}</div>
      <input
        aria-label="Class description"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {showRemove && !readOnly && (
        <button type="button" onClick={onRemove}>
          remove-item
        </button>
      )}
    </div>
  ),
}))

vi.mock('../../_base/hooks/use-available-var-list', () => ({
  default: vi.fn(() => ({
    availableVars: [{ variable: ['node-1', 'answer'], type: VarType.string }],
    availableNodesWithParent: [
      { id: 'node-1', data: { title: 'Answer', desc: '', type: BlockEnum.Answer } },
    ],
  })),
}))

vi.mock('../../../hooks/use-edges-interactions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-edges-interactions')>()
  return {
    ...actual,
    useEdgesInteractions: vi.fn(),
  }
})

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: vi.fn(),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: ({
    value,
  }: ComponentProps<
    typeof import('@/app/components/header/account-setting/model-provider-page/model-selector').ModelSelector
  >) => (
    <div>
      {value?.provider}:{value?.model}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  default: ({
    value,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var').default
  >) => <div>{value}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeSourceHandle: ({
    handleId,
  }: ComponentProps<
    typeof import('@/app/components/workflow/nodes/_base/components/node-handle').NodeSourceHandle
  >) => <div>handle-{handleId}</div>,
}))

const mockUseEdgesInteractions = vi.mocked(useEdgesInteractions)
const mockUseTextGeneration = vi.mocked(useTextGenerationCurrentProviderAndModelAndModelList)

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

const createData = (
  overrides: Partial<QuestionClassifierNodeType> = {},
): QuestionClassifierNodeType => ({
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

describe('question-classifier path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEdgesInteractions.mockReturnValue({
      handleEdgeDeleteByDeleteBranch: vi.fn(),
    } as unknown as ReturnType<typeof useEdgesInteractions>)
    mockUseTextGeneration.mockReturnValue({
      currentProvider: undefined,
      currentModel: undefined,
      textGenerationModelList: [
        {
          provider: 'openai',
          label: { en_US: 'OpenAI' },
          tenant_id: 'tenant-1',
          models: [],
          status: 'active',
        },
      ],
      activeTextGenerationModelList: [
        {
          provider: 'openai',
          label: { en_US: 'OpenAI' },
          tenant_id: 'tenant-1',
          models: [],
          status: 'active',
        },
      ],
    })
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
      await user.click(screen.getByRole('switch'))

      expect(onInstructionChange).toHaveBeenCalledWith('Route by topic!')
      expect(onMemoryChange).toHaveBeenCalledWith({
        window: { enabled: false, size: 50 },
        query_prompt_template: '{{#sys.query#}}\n\n{{#sys.files#}}',
      })
    })

    it('adds, edits, removes and collapses classes while retaining unrelated branches', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const removeEdge = vi.fn()
      mockUseEdgesInteractions.mockReturnValue({
        handleEdgeDeleteByDeleteBranch: removeEdge,
      } as unknown as ReturnType<typeof useEdgesInteractions>)
      function ClassListHarness() {
        const [list, setList] = useState([
          createTopic(),
          createTopic({ id: 'topic-2', name: 'Refunds' }),
        ])
        return (
          <ClassList
            nodeId="node-1"
            list={list}
            onChange={(next) => {
              setList(next)
              onChange(next)
            }}
            filterVar={() => true}
          />
        )
      }
      render(<ClassListHarness />)
      await user.click(
        screen.getByRole('button', { name: 'workflowModels.nodes.questionClassifiers.addClass' }),
      )
      expect(onChange).toHaveBeenLastCalledWith([
        createTopic(),
        createTopic({ id: 'topic-2', name: 'Refunds' }),
        expect.objectContaining({ id: expect.any(String), name: '' }),
      ])
      await user.type(screen.getByDisplayValue('Billing questions'), ' updated')
      expect(onChange).toHaveBeenLastCalledWith([
        createTopic({ name: 'Billing questions updated' }),
        createTopic({ id: 'topic-2', name: 'Refunds' }),
        expect.objectContaining({ name: '' }),
      ])
      await user.click(screen.getAllByRole('button', { name: 'remove-item' })[0]!)
      expect(screen.queryByDisplayValue('Billing questions updated')).not.toBeInTheDocument()
      expect(screen.getByDisplayValue('Refunds')).toBeInTheDocument()
      expect(removeEdge).toHaveBeenCalledExactlyOnceWith('node-1', 'topic-1')
      await user.click(
        screen.getByRole('button', { name: /workflow.nodes.questionClassifiers.class/ }),
      )
      expect(
        screen.queryByRole('button', { name: 'workflowModels.nodes.questionClassifiers.addClass' }),
      ).not.toBeInTheDocument()
      await user.click(
        screen.getByRole('button', { name: /workflow.nodes.questionClassifiers.class/ }),
      )
      expect(screen.getByDisplayValue('Refunds')).toBeInTheDocument()
    })

    it('prevents editing descriptions and memory settings in readonly mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onMemoryChange = vi.fn()
      render(
        <>
          <ClassList
            nodeId="node-1"
            list={[createTopic()]}
            onChange={onChange}
            filterVar={() => true}
            readonly
          />
          <AdvancedSetting
            instruction="Route by topic"
            onInstructionChange={onChange}
            hideMemorySetting={false}
            onMemoryChange={onMemoryChange}
            isChatModel
            isChatApp
            nodesOutputVars={[]}
            availableNodes={[]}
            readonly
          />
        </>,
      )
      await user.type(screen.getByDisplayValue('Billing questions'), '!')
      expect(onChange).not.toHaveBeenCalled()
      expect(screen.queryByRole('button', { name: 'remove-item' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'workflowModels.nodes.questionClassifiers.addClass' }),
      ).not.toBeInTheDocument()
      expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
      await user.click(screen.getByRole('switch'))
      expect(onMemoryChange).not.toHaveBeenCalled()
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
      await user.hover(screen.getByRole('button', { name: longName }))
      expect(await screen.findByText(longName)).toBeInTheDocument()

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
  })
})
