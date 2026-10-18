import type { ComponentProps } from 'react'
import type { Topic } from '@/app/components/workflow/nodes/_base/components/branch-list/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useEdges } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import ClassList from '../../_base/components/branch-list/class-list'
import AdvancedSetting from '../components/advanced-setting'

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

const createTopic = (overrides: Partial<Topic> = {}): Topic => ({
  id: 'topic-1',
  name: 'Billing questions',
  ...overrides,
})

describe('question-classifier path', () => {
  // Class editing and advanced settings share the real branch and memory controls.
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
      function ClassListHarness() {
        const [list, setList] = useState(() => [
          createTopic(),
          createTopic({ id: 'topic-2', name: 'Refunds' }),
        ])
        const edges = useEdges()
        return (
          <>
            <output aria-label="Connected branches">
              {edges.map((edge) => edge.sourceHandle).join(',')}
            </output>
            <ClassList
              nodeId="node-1"
              list={list}
              onChange={(next) => {
                setList(next)
                onChange(next)
              }}
              filterVar={() => true}
            />
          </>
        )
      }
      const nodes = [
        createNode({ id: 'node-1', data: { type: BlockEnum.QuestionClassifier } }),
        createNode({ id: 'answer-1', data: { type: BlockEnum.Answer } }),
        createNode({ id: 'answer-2', data: { type: BlockEnum.Answer } }),
      ]
      const edges = [
        createEdge({ source: 'node-1', sourceHandle: 'topic-1', target: 'answer-1' }),
        createEdge({ source: 'node-1', sourceHandle: 'topic-2', target: 'answer-2' }),
      ]
      render(<ClassListHarness />, { nodes, edges, historyStore: { nodes, edges } })
      expect(screen.getByLabelText('Connected branches')).toHaveTextContent('topic-1,topic-2')
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
      expect(screen.getByLabelText('Connected branches').textContent).toBe('topic-2')
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
  })
})
