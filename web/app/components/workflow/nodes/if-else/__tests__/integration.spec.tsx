import type { IfElseNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useNodes } from 'reactflow'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { createEdge, createNode, createStartNode } from '../../../__tests__/fixtures'
import { BlockEnum, InputVarType, VarType } from '../../../types'
import ConditionOperator from '../components/condition-list/condition-operator'
import ConditionNumberInput from '../components/condition-number-input'
import Panel from '../panel'
import { ComparisonOperator, LogicalOperator } from '../types'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'spec.schemaDefinitions.get': async () => [],
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

const createData = (overrides: Partial<IfElseNodeType> = {}): IfElseNodeType => ({
  title: 'If Else',
  desc: '',
  type: BlockEnum.IfElse,
  isInIteration: false,
  isInLoop: false,
  cases: [
    {
      case_id: 'case-1',
      logical_operator: LogicalOperator.and,
      conditions: [
        {
          id: 'condition-1',
          varType: VarType.string,
          variable_selector: ['node-1', 'answer'],
          comparison_operator: ComparisonOperator.contains,
          value: 'hello',
        },
      ],
    },
  ],
  ...overrides,
})

const render = (
  ui: Parameters<typeof renderWorkflowFlowComponent>[0],
  options: Parameters<typeof renderWorkflowFlowComponent>[1] = {},
) =>
  renderWorkflowFlowComponent(ui, {
    nodes: [
      {
        id: 'node-1',
        position: { x: 0, y: 0 },
        data: { title: 'Start Node', desc: '', type: BlockEnum.Start },
      },
    ],
    ...options,
  })
const numberVariables = [
  { nodeId: 'node-1', title: 'Start Node', vars: [{ variable: 'score', type: VarType.number }] },
]

function LivePanel() {
  const node = useNodes<IfElseNodeType>().find((node) => node.id === 'if-else-node')
  if (!node) return null
  return (
    <>
      <Panel
        id={node.id}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: () => {},
          runResult: null,
        }}
      />
      <output aria-label="Saved cases">{JSON.stringify(node.data.cases)}</output>
    </>
  )
}
const readCases = (): IfElseNodeType['cases'] =>
  JSON.parse(screen.getByRole('status', { name: 'Saved cases' }).textContent!)
const renderPanel = (data: IfElseNodeType) =>
  render(<LivePanel />, {
    nodes: [
      createStartNode({
        id: 'node-1',
        data: {
          variables: [
            { variable: 'score', label: 'Score', type: InputVarType.number, required: true },
            { variable: 'answer', label: 'Answer', type: InputVarType.textInput, required: true },
          ],
        },
      }),
      createNode({ id: 'if-else-node', data }),
    ],
    edges: [createEdge({ source: 'node-1', target: 'if-else-node' })],
  })

describe('if-else path', () => {
  describe('Condition controls', () => {
    it('adds a selected upstream variable to the saved case', async () => {
      const user = userEvent.setup()
      renderPanel(
        createData({
          cases: [{ case_id: 'case-1', logical_operator: LogicalOperator.and, conditions: [] }],
        }),
      )
      await user.click(
        screen.getByRole('button', { name: /workflowLogic.nodes.ifElse.addCondition/i }),
      )
      await user.click(await screen.findByText('score'))
      expect(readCases()[0]!.conditions).toEqual([
        expect.objectContaining({
          variable_selector: ['node-1', 'score'],
          varType: VarType.number,
        }),
      ])
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    })

    it('edits a constant then switches to a real numeric variable selection', async () => {
      const user = userEvent.setup()
      const onValueChange = vi.fn()
      const NumberCondition = () => {
        const [kind, setKind] = useState<VarKindType>(VarKindType.constant)
        const [value, setValue] = useState('12')
        return (
          <ConditionNumberInput
            value={value}
            numberVarType={kind}
            onNumberVarTypeChange={(next) => {
              setKind(next)
              setValue('')
            }}
            onValueChange={(next) => {
              setValue(next)
              onValueChange(next)
            }}
            variables={numberVariables}
            unit="%"
          />
        )
      }
      render(<NumberCondition />)
      await user.clear(screen.getByRole('spinbutton'))
      await user.type(screen.getByRole('spinbutton'), '42')
      expect(onValueChange).toHaveBeenLastCalledWith('42')
      await user.click(screen.getByRole('button', { name: /constant/i }))
      await user.click(screen.getByRole('menuitemradio', { name: 'Variable' }))
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
      await user.click(screen.getByText('workflowLogic.nodes.ifElse.selectVariable'))
      await user.click(await screen.findByText('score'))
      expect(onValueChange).toHaveBeenLastCalledWith('{{#node-1.score#}}')
    })

    it('selects a compatible string comparison operator', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()
      render(
        <ConditionOperator
          varType={VarType.string}
          value={ComparisonOperator.contains}
          onSelect={onSelect}
        />,
      )
      await user.click(screen.getByRole('button', { name: /contains/i }))
      await user.click(screen.getByText('workflowLogic.nodes.ifElse.comparisonOperator.is'))
      expect(onSelect.mock.calls[0]?.[0]).toBe(ComparisonOperator.is)
    })

    it('toggles and saves the logical operator for multiple conditions', async () => {
      const user = userEvent.setup()
      const data = createData()
      data.cases[0]!.conditions.push({
        ...data.cases[0]!.conditions[0]!,
        id: 'condition-2',
        value: 'world',
      })
      renderPanel(data)
      await user.click(screen.getByText('AND'))
      expect(screen.getByText('OR')).toBeInTheDocument()
      expect(readCases()[0]!.logical_operator).toBe(LogicalOperator.or)
      expect(readCases()[0]!.conditions).toEqual(data.cases[0]!.conditions)
    })
  })

  describe('Panel integration', () => {
    it('should add a case from the panel action and render else description', async () => {
      const user = userEvent.setup()
      const inputs = createData({ cases: [] })
      renderPanel(inputs)

      await user.click(screen.getByRole('button', { name: /elif/i }))

      expect(readCases()).toEqual([
        { case_id: expect.any(String), logical_operator: LogicalOperator.and, conditions: [] },
      ])
      expect(
        screen.getByRole('button', { name: /workflowLogic.nodes.ifElse.addCondition/i }),
      ).toBeInTheDocument()
      expect(screen.getByText('workflowLogic.nodes.ifElse.elseDescription')).toBeInTheDocument()
    })
  })
})
