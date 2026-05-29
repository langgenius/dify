import type { InputVar, Node, Variable } from '../../../types'
import type { Condition } from '../types'
import { BlockEnum, InputVarType, ValueType, VarType } from '@/app/components/workflow/types'
import { VALUE_SELECTOR_DELIMITER } from '@/config'
import { ComparisonOperator, LogicalOperator } from '../types'
import {
  buildUsedOutVars,
  createInputVarValues,
  dedupeInputVars,
  getDependentVarsFromLoopPayload,
  getVarSelectorsFromCase,
  getVarSelectorsFromCondition,
} from '../use-single-run-form-params.helpers'

const mockGetNodeInfoById = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVarPassToServerKey = vi.hoisted(() => vi.fn())
const mockGetNodeUsedVars = vi.hoisted(() => vi.fn())
const mockIsSystemVar = vi.hoisted(() => vi.fn())

vi.mock('../../_base/components/variable/utils', () => ({
  getNodeInfoById: (...args: unknown[]) => mockGetNodeInfoById(...args),
  getNodeUsedVarPassToServerKey: (...args: unknown[]) => mockGetNodeUsedVarPassToServerKey(...args),
  getNodeUsedVars: (...args: unknown[]) => mockGetNodeUsedVars(...args),
  isSystemVar: (...args: unknown[]) => mockIsSystemVar(...args),
}))

const createNode = (id: string, title: string, type = BlockEnum.Tool): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {
    title,
    desc: '',
    type,
  },
} as Node)

const createInputVar = (variable: string, label: InputVar['label'] = variable): InputVar => ({
  type: InputVarType.textInput,
  label,
  variable,
  required: false,
})

const createCondition = (overrides: Partial<Condition> = {}): Condition => ({
  id: 'condition-1',
  varType: VarType.string,
  variable_selector: ['tool-node', 'value'],
  comparison_operator: ComparisonOperator.equal,
  value: '',
  ...overrides,
})

describe('use-single-run-form-params helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should collect var selectors from conditions and nested cases', () => {
    const nestedCondition = createCondition({
      variable_selector: ['tool-node', 'value'],
      sub_variable_condition: {
        logical_operator: LogicalOperator.and,
        conditions: [
          createCondition({
            id: 'sub-condition-1',
            variable_selector: ['start-node', 'answer'],
          }),
        ],
      },
    })

    expect(getVarSelectorsFromCondition(nestedCondition)).toEqual([
      ['tool-node', 'value'],
      ['start-node', 'answer'],
    ])
    expect(getVarSelectorsFromCase({
      logical_operator: LogicalOperator.or,
      conditions: [
        nestedCondition,
        createCondition({
          id: 'condition-2',
          variable_selector: ['other-node', 'result'],
        }),
      ],
    })).toEqual([
      ['tool-node', 'value'],
      ['start-node', 'answer'],
      ['other-node', 'result'],
    ])
  })

  it('should copy input values and dedupe duplicate or invalid input vars', () => {
    const source = {
      question: 'hello',
      retry: true,
    }

    const values = createInputVarValues(source)
    const deduped = dedupeInputVars([
      createInputVar('tool-node.value'),
      createInputVar('tool-node.value'),
      undefined as unknown as InputVar,
      createInputVar('start-node.answer'),
    ])

    expect(values).toEqual(source)
    expect(values).not.toBe(source)
    expect(deduped).toEqual([
      createInputVar('tool-node.value'),
      createInputVar('start-node.answer'),
    ])
  })

  it('should build used output vars and pass-to-server keys while filtering loop-local selectors', () => {
    const startNode = createNode('start-node', 'Start Node', BlockEnum.Start)
    const sysNode = createNode('sys', 'System', BlockEnum.Start)
    const loopChildrenNodes = [
      createNode('tool-a', 'Tool A'),
      createNode('tool-b', 'Tool B'),
      createNode('current-node', 'Current Node'),
      createNode('inner-node', 'Inner Node'),
    ]

    mockGetNodeUsedVars.mockImplementation((node: Node) => {
      switch (node.id) {
        case 'tool-a':
          return [['sys', 'files']]
        case 'tool-b':
          return [['start-node', 'answer'], ['current-node', 'self'], ['inner-node', 'secret']]
        default:
          return []
      }
    })
    mockGetNodeUsedVarPassToServerKey.mockImplementation((_node: Node, selector: string[]) => {
      return selector[0] === 'sys' ? ['sys_files', 'sys_files_backup'] : 'answer_key'
    })
    mockGetNodeInfoById.mockImplementation((nodes: Node[], id: string) => nodes.find(node => node.id === id))
    mockIsSystemVar.mockImplementation((selector: string[]) => selector[0] === 'sys')

    const toVarInputs = vi.fn((variables: Variable[]) => variables.map(variable => createInputVar(
      variable.variable,
      variable.label as InputVar['label'],
    )))

    const result = buildUsedOutVars({
      loopChildrenNodes,
      currentNodeId: 'current-node',
      canChooseVarNodes: [startNode, sysNode, ...loopChildrenNodes],
      isNodeInLoop: nodeId => nodeId === 'inner-node',
      toVarInputs,
    })

    expect(toVarInputs).toHaveBeenCalledWith([
      expect.objectContaining({
        variable: 'sys.files',
        label: {
          nodeType: BlockEnum.Start,
          nodeName: 'System',
          variable: 'sys.files',
        },
      }),
      expect.objectContaining({
        variable: 'start-node.answer',
        label: {
          nodeType: BlockEnum.Start,
          nodeName: 'Start Node',
          variable: 'answer',
        },
      }),
    ])
    expect(result.usedOutVars).toEqual([
      createInputVar('sys.files', {
        nodeType: BlockEnum.Start,
        nodeName: 'System',
        variable: 'sys.files',
      }),
      createInputVar('start-node.answer', {
        nodeType: BlockEnum.Start,
        nodeName: 'Start Node',
        variable: 'answer',
      }),
    ])
    expect(result.allVarObject).toEqual({
      [['sys.files', 'tool-a', 0].join(VALUE_SELECTOR_DELIMITER)]: {
        inSingleRunPassedKey: 'sys_files',
      },
      [['sys.files', 'tool-a', 1].join(VALUE_SELECTOR_DELIMITER)]: {
        inSingleRunPassedKey: 'sys_files_backup',
      },
      [['start-node.answer', 'tool-b', 0].join(VALUE_SELECTOR_DELIMITER)]: {
        inSingleRunPassedKey: 'answer_key',
      },
    })
  })

  it('should derive dependent vars from payload and filter current node references', () => {
    const dependentVars = getDependentVarsFromLoopPayload({
      nodeId: 'loop-node',
      usedOutVars: [
        createInputVar('start-node.answer'),
        createInputVar('loop-node.internal'),
      ],
      breakConditions: [
        createCondition({
          variable_selector: ['tool-node', 'value'],
          sub_variable_condition: {
            logical_operator: LogicalOperator.and,
            conditions: [
              createCondition({
                id: 'sub-condition-1',
                variable_selector: ['loop-node', 'ignored'],
              }),
            ],
          },
        }),
      ],
      loopVariables: [
        {
          id: 'loop-variable-1',
          label: 'Loop Input',
          var_type: VarType.string,
          value_type: ValueType.variable,
          value: ['tool-node', 'next'],
        },
        {
          id: 'loop-variable-2',
          label: 'Constant',
          var_type: VarType.string,
          value_type: ValueType.constant,
          value: 'plain-text',
        },
      ],
    })

    expect(dependentVars).toEqual([
      ['start-node', 'answer'],
      ['tool-node', 'value'],
      ['tool-node', 'next'],
    ])
  })
})
