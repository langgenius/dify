import type { CommonNodeType, Edge, Node } from '../../types'
import type { LayoutResult } from '../elk-layout'
import { createEdge, createNode, resetFixtureCounters } from '../../__tests__/fixtures'
import { CUSTOM_NODE } from '../../constants'
import { CUSTOM_ITERATION_START_NODE } from '../../nodes/iteration-start/constants'
import { CUSTOM_LOOP_START_NODE } from '../../nodes/loop-start/constants'
import { BlockEnum } from '../../types'
import { getLayoutByELK, getLayoutForChildNodes } from '../elk-layout'

const node = (
  id: string,
  data: Partial<CommonNodeType> & Record<string, unknown> = {},
  extra: Partial<Node> = {},
) => createNode({ id, type: CUSTOM_NODE, data: { type: BlockEnum.Code, ...data }, ...extra })
const edge = (
  source: string,
  target: string,
  sourceHandle?: string,
  data?: Partial<Edge['data']>,
) => createEdge({ source, target, sourceHandle, data })

function expectUsableLayout(result: LayoutResult, ids: string[]) {
  expect([...result.nodes.keys()].sort()).toEqual([...ids].sort())
  expect(result.bounds.minX).toBe(0)
  expect(result.bounds.minY).toBe(0)
  const boxes = [...result.nodes.values()]
  for (const box of boxes) {
    expect([box.x, box.y, box.width, box.height].every(Number.isFinite)).toBe(true)
    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!
      const b = boxes[j]!
      expect(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ).toBe(true)
    }
  }
  expect(result.bounds.maxX).toBeCloseTo(Math.max(...boxes.map((box) => box.x + box.width)))
  expect(result.bounds.maxY).toBeCloseTo(Math.max(...boxes.map((box) => box.y + box.height)))
}

const branchCases = [
  {
    type: BlockEnum.IfElse,
    config: { cases: [{ case_id: 'first' }, { case_id: 'second' }] },
    handles: ['first', 'second', 'false'],
  },
  {
    type: BlockEnum.HumanInput,
    config: { user_actions: [{ id: 'first' }, { id: 'second' }] },
    handles: ['first', 'second', '__timeout'],
  },
  {
    type: BlockEnum.QuestionClassifier,
    config: {
      classes: [
        { id: 'first', name: 'First' },
        { id: 'second', name: 'Second' },
        { id: 'third', name: 'Third' },
      ],
    },
    handles: ['first', 'second', 'third'],
  },
]

beforeEach(resetFixtureCounters)

describe('getLayoutByELK with the real layout engine', () => {
  it('lays a linear graph left to right, normalizes bounds and leaves its inputs unchanged', async () => {
    const nodes = [
      node('a', { type: BlockEnum.Start }),
      node('b', {}, { width: 320, height: 180 }),
      node('c', { type: BlockEnum.End }),
    ]
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const snapshot = structuredClone({ nodes, edges })
    const result = await getLayoutByELK(nodes, edges)

    expectUsableLayout(result, ['a', 'b', 'c'])
    expect(result.nodes.get('a')!.x + result.nodes.get('a')!.width).toBeLessThan(
      result.nodes.get('b')!.x,
    )
    expect(result.nodes.get('b')!.x + 320).toBeLessThan(result.nodes.get('c')!.x)
    expect(result.nodes.get('b')).toMatchObject({ width: 320, height: 180 })
    expect({ nodes, edges }).toEqual(snapshot)
  })

  it('uses default dimensions for an unmeasured node', async () => {
    const unmeasured = node('a', {}, { width: undefined, height: undefined })
    const result = await getLayoutByELK([unmeasured], [])
    expect(result.nodes.get('a')).toMatchObject({ x: 0, y: 0, width: 244, height: 100 })
  })

  it('returns zero bounds for an empty graph', async () => {
    const result = await getLayoutByELK([], [])
    expect(result.nodes.size).toBe(0)
    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 })
  })

  it.each(branchCases)(
    'orders $type branches by configured handles with the fallback last',
    async ({ type, config, handles }) => {
      const nodes = [
        node('branch', { type, ...config }),
        node('last'),
        node('middle'),
        node('first'),
      ]
      const edges = [
        edge('branch', 'last', handles[2]),
        edge('branch', 'middle', handles[1]),
        edge('branch', 'first', handles[0]),
      ]
      const result = await getLayoutByELK(nodes, edges)

      expectUsableLayout(
        result,
        nodes.map((item) => item.id),
      )
      expect(result.nodes.get('first')!.y).toBeLessThan(result.nodes.get('middle')!.y)
      expect(result.nodes.get('middle')!.y).toBeLessThan(result.nodes.get('last')!.y)
      for (const id of ['first', 'middle', 'last'])
        expect(result.nodes.get(id)!.x).toBeGreaterThan(result.nodes.get('branch')!.x)
    },
  )

  it('supports several edges sharing one output handle', async () => {
    const nodes = [node('start'), node('first'), node('second'), node('end')]
    const result = await getLayoutByELK(nodes, [
      edge('start', 'first', 'source'),
      edge('start', 'second', 'source'),
      edge('first', 'end'),
      edge('second', 'end'),
    ])
    expectUsableLayout(
      result,
      nodes.map((item) => item.id),
    )
    expect(result.nodes.get('start')!.x).toBeLessThan(result.nodes.get('first')!.x)
    expect(result.nodes.get('start')!.x).toBeLessThan(result.nodes.get('second')!.x)
    expect(result.nodes.get('end')!.x).toBeGreaterThan(result.nodes.get('second')!.x)
  })

  it.each([BlockEnum.IfElse, BlockEnum.HumanInput, BlockEnum.QuestionClassifier])(
    'lays out incomplete %s configuration without dropping targets',
    async (type) => {
      const nodes = [node('branch', { type }), node('first'), node('second')]
      const result = await getLayoutByELK(nodes, [
        edge('branch', 'first', 'unknown'),
        edge('branch', 'second'),
      ])
      expectUsableLayout(
        result,
        nodes.map((item) => item.id),
      )
    },
  )

  it('keeps cycles and disconnected nodes in a finite nonoverlapping layout', async () => {
    const nodes = [node('a'), node('b'), node('c'), node('isolated')]
    const result = await getLayoutByELK(nodes, [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    expectUsableLayout(
      result,
      nodes.map((item) => item.id),
    )
  })

  it('excludes nested nodes, special start nodes and edges whose endpoints are outside the root graph', async () => {
    const nodes = [
      node('parent', { type: BlockEnum.Iteration }),
      node('root'),
      node('child', {}, { parentId: 'parent' }),
      node('start', { type: BlockEnum.IterationStart }, { type: CUSTOM_ITERATION_START_NODE }),
    ]
    const result = await getLayoutByELK(nodes, [
      edge('parent', 'root'),
      edge('start', 'child', undefined, { isInIteration: true, iteration_id: 'parent' }),
      edge('root', 'child'),
      edge('root', 'deleted'),
      edge('missing', 'root'),
    ])
    expectUsableLayout(result, ['parent', 'root'])
    expect(result.nodes.get('root')!.x).toBeGreaterThan(result.nodes.get('parent')!.x)
  })
})

describe('getLayoutForChildNodes', () => {
  it('returns null when the requested parent has no children', async () => {
    expect(await getLayoutForChildNodes('parent', [node('parent')], [])).toBeNull()
  })

  it.each([
    {
      type: CUSTOM_ITERATION_START_NODE,
      block: BlockEnum.IterationStart,
      data: { isInIteration: true, iteration_id: 'parent' },
    },
    {
      type: CUSTOM_LOOP_START_NODE,
      block: BlockEnum.LoopStart,
      data: { isInLoop: true, loop_id: 'parent' },
    },
  ])('lays out only the requested container using $type', async ({ type, block, data }) => {
    const nodes = [
      node('parent'),
      node('start', { type: block }, { type, parentId: 'parent' }),
      node('child', {}, { parentId: 'parent' }),
      node('elsewhere', {}, { parentId: 'other' }),
    ]
    const edges = [
      edge('start', 'child', undefined, data),
      edge('child', 'elsewhere', undefined, data),
      edge('unknown', 'child', undefined, data),
    ]
    const snapshot = structuredClone({ nodes, edges })
    const result = await getLayoutForChildNodes('parent', nodes, edges)
    expect(result).not.toBeNull()
    expectUsableLayout(result!, ['start', 'child'])
    expect(result!.nodes.get('start')!.x).toBeLessThan(result!.nodes.get('child')!.x)
    expect({ nodes, edges }).toEqual(snapshot)
  })

  it('preserves branch order inside an iteration', async () => {
    const data = { isInIteration: true, iteration_id: 'parent' }
    const nodes = [
      node(
        'start',
        { type: BlockEnum.IterationStart },
        { type: CUSTOM_ITERATION_START_NODE, parentId: 'parent' },
      ),
      node(
        'branch',
        { type: BlockEnum.QuestionClassifier, classes: [{ id: 'first' }, { id: 'second' }] },
        { parentId: 'parent' },
      ),
      node('upper', {}, { parentId: 'parent' }),
      node('lower', {}, { parentId: 'parent' }),
    ]
    const result = await getLayoutForChildNodes('parent', nodes, [
      edge('start', 'branch', undefined, data),
      edge('branch', 'lower', 'second', data),
      edge('branch', 'upper', 'first', data),
    ])
    expectUsableLayout(
      result!,
      nodes.map((item) => item.id),
    )
    expect(result!.nodes.get('upper')!.y).toBeLessThan(result!.nodes.get('lower')!.y)
  })
})
