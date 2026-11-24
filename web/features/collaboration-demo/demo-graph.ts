import type { Edge, Node } from '@/app/components/workflow/types'
import { CUSTOM_EDGE, CUSTOM_NODE } from '@/app/components/workflow/constants'
import { ComparisonOperator, LogicalOperator } from '@/app/components/workflow/nodes/if-else/types'
import { BlockEnum } from '@/app/components/workflow/types'

export type DemoNodeTitles = {
  start: string
  checkOrder: string
  lookupRefund: string
  generateReply: string
  refundStatus: string
  askOrder: string
}

export const demoNodePositions = {
  start: { x: 40, y: 300 },
  checkOrder: { x: 360, y: 260 },
  lookupRefund: { x: 680, y: 140 },
  generateReply: { x: 680, y: 440 },
  refundStatus: { x: 1000, y: 140 },
  askOrder: { x: 1000, y: 440 },
} as const

export type DemoNodeId = keyof typeof demoNodePositions

const positions = Object.values(demoNodePositions)
const graphLeft = Math.min(...positions.map(({ x }) => x))
const graphTop = Math.min(...positions.map(({ y }) => y))

export const demoGraphBounds = {
  x: graphLeft,
  y: graphTop,
  width: Math.max(...positions.map(({ x }) => x)) + 240 - graphLeft,
  height: Math.max(...positions.map(({ y }) => y)) + 100 - graphTop,
}

const node = (id: DemoNodeId, type: BlockEnum, title: string, extra: object = {}): Node =>
  ({
    id,
    type: CUSTOM_NODE,
    position: demoNodePositions[id],
    data: { type, title, desc: '', selected: false, ...extra },
  }) as Node

const edge = (
  source: DemoNodeId,
  target: DemoNodeId,
  sourceType: BlockEnum,
  targetType: BlockEnum,
  sourceHandle = 'source',
): Edge =>
  ({
    id: `${source}-${sourceHandle}-${target}`,
    type: CUSTOM_EDGE,
    source,
    target,
    sourceHandle,
    targetHandle: 'target',
    data: { sourceType, targetType },
  }) as Edge

export function createDemoGraph(titles: DemoNodeTitles) {
  const nodes = [
    node('start', BlockEnum.Start, titles.start, { variables: [] }),
    node('checkOrder', BlockEnum.IfElse, titles.checkOrder, {
      cases: [
        {
          case_id: 'true',
          logical_operator: LogicalOperator.and,
          conditions: [
            {
              id: 'has-order',
              varType: 'string',
              variable_selector: ['start', 'order_id'],
              comparison_operator: ComparisonOperator.notEmpty,
              value: '',
            },
          ],
        },
      ],
    }),
    node('lookupRefund', BlockEnum.HttpRequest, titles.lookupRefund),
    node('generateReply', BlockEnum.LLM, titles.generateReply),
    node('refundStatus', BlockEnum.Answer, titles.refundStatus),
    node('askOrder', BlockEnum.Answer, titles.askOrder),
  ]
  const edges = [
    edge('start', 'checkOrder', BlockEnum.Start, BlockEnum.IfElse),
    edge('checkOrder', 'lookupRefund', BlockEnum.IfElse, BlockEnum.HttpRequest, 'true'),
    edge('checkOrder', 'generateReply', BlockEnum.IfElse, BlockEnum.LLM, 'false'),
    edge('lookupRefund', 'refundStatus', BlockEnum.HttpRequest, BlockEnum.Answer),
    edge('generateReply', 'askOrder', BlockEnum.LLM, BlockEnum.Answer),
  ]
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}
