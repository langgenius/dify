import type { Var } from '../../../types'
import type { IfElseNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum, VarType } from '../../../types'
import ConditionAdd from '../components/condition-add'
import ConditionFilesListValue from '../components/condition-files-list-value'
import ConditionList from '../components/condition-list'
import ConditionOperator from '../components/condition-list/condition-operator'
import ConditionNumberInput from '../components/condition-number-input'
import ConditionValue from '../components/condition-value'
import Node from '../node'
import Panel from '../panel'
import { ComparisonOperator, LogicalOperator } from '../types'
import useConfig from '../use-config'

vi.mock('react-sortablejs', () => ({
  ReactSortable: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock(
  '@/app/components/workflow/nodes/_base/components/variable/variable-label',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/components/workflow/nodes/_base/components/variable/variable-label')
    >()),
    VariableLabelInText: ({ variables }: { variables: string[] }) => (
      <div>{variables.join('.')}</div>
    ),
    VariableLabelInNode: ({ variables }: { variables: string[] }) => (
      <div>{variables.join('.')}</div>
    ),
  }),
)

vi.mock('@/app/components/workflow/nodes/_base/components/variable-tag', () => ({
  __esModule: true,
  default: ({ valueSelector }: { valueSelector: string[] }) => <div>{valueSelector.join('.')}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/node-handle', () => ({
  NodeSourceHandle: ({ handleId }: { handleId: string }) => (
    <div data-testid={`handle-${handleId}`} />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/use-match-schema-type', () => ({
  __esModule: true,
  default: () => ({
    schemaTypeDefinitions: [],
    matchSchemaType: () => undefined,
  }),
}))

vi.mock('../../variable-assigner/hooks', () => ({
  useGetAvailableVars: () => () => [
    {
      variable: ['node-1', 'score'],
      type: VarType.number,
    },
  ],
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)

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

const createConfigResult = (
  overrides: Partial<ReturnType<typeof useConfig>> = {},
): ReturnType<typeof useConfig> => ({
  readOnly: false,
  inputs: createData(),
  filterVar: () => true,
  filterNumberVar: (varPayload: Var) => varPayload.type === VarType.number,
  handleAddCase: vi.fn(),
  handleRemoveCase: vi.fn(),
  handleSortCase: vi.fn(),
  handleAddCondition: vi.fn(),
  handleUpdateCondition: vi.fn(),
  handleRemoveCondition: vi.fn(),
  handleToggleConditionLogicalOperator: vi.fn(),
  handleAddSubVariableCondition: vi.fn(),
  handleRemoveSubVariableCondition: vi.fn(),
  handleUpdateSubVariableCondition: vi.fn(),
  handleToggleSubVariableConditionLogicalOperator: vi.fn(),
  nodesOutputVars: [
    {
      nodeId: 'node-1',
      title: 'Start Node',
      vars: [
        {
          variable: 'answer',
          type: VarType.string,
        },
      ],
    },
  ],
  availableNodes: [],
  nodesOutputNumberVars: [
    {
      nodeId: 'node-1',
      title: 'Start Node',
      vars: [
        {
          variable: 'score',
          type: VarType.number,
        },
      ],
    },
  ],
  availableNumberNodes: [],
  varsIsVarFileAttribute: {},
  ...overrides,
})

const baseNodeProps = {
  type: 'custom',
  selected: false,
  zIndex: 1,
  xPos: 0,
  yPos: 0,
  dragging: false,
  isConnectable: true,
}

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

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
const renderWithConsoleQuery = render
const numberVariables = [
  { nodeId: 'node-1', title: 'Start Node', vars: [{ variable: 'score', type: VarType.number }] },
]

describe('if-else path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  describe('Condition controls', () => {
    it('should add a condition variable from the selector', async () => {
      const user = userEvent.setup()
      const onSelectVariable = vi.fn()

      render(
        <ConditionAdd
          caseId="case-1"
          variables={numberVariables}
          onSelectVariable={onSelectVariable}
        />,
        {
          resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
        },
      )

      await user.click(
        screen.getByRole('button', { name: /workflowLogic.nodes.ifElse.addCondition/i }),
      )
      await user.click(await screen.findByText('score'))

      expect(onSelectVariable).toHaveBeenCalledWith('case-1', ['node-1', 'score'], {
        variable: 'score',
        type: VarType.number,
      })
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

    it('should toggle logical operators for a case list with multiple conditions', async () => {
      const user = userEvent.setup()
      const onToggleConditionLogicalOperator = vi.fn()

      renderWithConsoleQuery(
        <ConditionList
          caseId="case-1"
          caseItem={{
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
              {
                id: 'condition-2',
                varType: VarType.string,
                variable_selector: ['node-1', 'answer'],
                comparison_operator: ComparisonOperator.is,
                value: 'world',
              },
            ],
          }}
          nodeId="node-1"
          nodesOutputVars={[]}
          availableNodes={[]}
          numberVariables={[]}
          filterVar={() => true}
          varsIsVarFileAttribute={{}}
          onToggleConditionLogicalOperator={onToggleConditionLogicalOperator}
        />,
      )

      await user.click(screen.getByText('AND'))

      expect(onToggleConditionLogicalOperator).toHaveBeenCalledWith('case-1')
    })
  })

  describe('Display rendering', () => {
    it('should render formatted condition values and file sub-conditions', () => {
      render(
        <div>
          <ConditionValue
            variableSelector={['node-1', 'answer']}
            operator={ComparisonOperator.contains}
            value="{{#node-1.answer#}}"
          />
          <ConditionFilesListValue
            condition={{
              id: 'condition-files',
              varType: VarType.object,
              variable_selector: ['node-1', 'files'],
              comparison_operator: ComparisonOperator.contains,
              value: '',
              sub_variable_condition: {
                case_id: 'sub-case',
                logical_operator: LogicalOperator.or,
                conditions: [
                  {
                    id: 'sub-condition',
                    key: 'name',
                    varType: VarType.string,
                    comparison_operator: ComparisonOperator.contains,
                    value: 'report',
                  },
                ],
              },
            }}
          />
        </div>,
        { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
      )

      expect(screen.getByText('node-1.answer')).toBeInTheDocument()
      expect(screen.getByText('{{answer}}')).toBeInTheDocument()
      expect(screen.getByText('node-1.files')).toBeInTheDocument()
      expect(screen.getByText('name')).toBeInTheDocument()
      expect(screen.getByText('report')).toBeInTheDocument()
    })

    it('should render node cases, missing setup state, and else handles', () => {
      render(
        <Node
          id="if-else-node"
          {...baseNodeProps}
          data={createData({
            cases: [
              {
                case_id: 'case-1',
                logical_operator: LogicalOperator.and,
                conditions: [
                  {
                    id: 'condition-empty',
                    varType: VarType.string,
                    variable_selector: [],
                    comparison_operator: ComparisonOperator.contains,
                    value: '',
                  },
                ],
              },
              {
                case_id: 'case-2',
                logical_operator: LogicalOperator.or,
                conditions: [
                  {
                    id: 'condition-ready',
                    varType: VarType.boolean,
                    variable_selector: ['node-1', 'passed'],
                    comparison_operator: ComparisonOperator.is,
                    value: false,
                  },
                ],
              },
            ],
          })}
        />,
        { resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
      )

      expect(screen.getByText('IF')).toBeInTheDocument()
      expect(screen.getByText('ELIF')).toBeInTheDocument()
      expect(screen.getByText('workflowLogic.nodes.ifElse.conditionNotSetup')).toBeInTheDocument()
      expect(screen.getByText('False')).toBeInTheDocument()
      expect(screen.getByText('ELSE')).toBeInTheDocument()
      expect(screen.getByTestId('handle-case-1')).toBeInTheDocument()
      expect(screen.getByTestId('handle-case-2')).toBeInTheDocument()
      expect(screen.getByTestId('handle-false')).toBeInTheDocument()
    })
  })

  describe('Panel integration', () => {
    it('should add a case from the panel action and render else description', async () => {
      const user = userEvent.setup()
      const handleAddCase = vi.fn()
      const inputs = createData({ cases: [] })

      mockUseConfig.mockReturnValueOnce(
        createConfigResult({
          inputs,
          handleAddCase,
        }),
      )

      render(<Panel id="if-else-node" data={inputs} panelProps={panelProps} />, {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      })

      await user.click(screen.getByRole('button', { name: /elif/i }))

      expect(handleAddCase).toHaveBeenCalled()
      expect(screen.getByText('workflowLogic.nodes.ifElse.elseDescription')).toBeInTheDocument()
    })
  })
})
