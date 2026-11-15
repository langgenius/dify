import {
  createNode,
  createStartNode,
  createTriggerNode,
  resetFixtureCounters,
} from '../../__tests__/fixtures'
import { BlockEnum } from '../../types'
import { getWorkflowEntryNode, isTriggerWorkflow, isWorkflowEntryNode } from '../workflow-entry'

beforeEach(() => {
  resetFixtureCounters()
})

describe('getWorkflowEntryNode', () => {
  it.each([BlockEnum.TriggerWebhook, BlockEnum.TriggerSchedule, BlockEnum.TriggerPlugin])(
    'prefers the %s trigger over the start node',
    (type) => {
      const nodes = [
        createStartNode({ id: 'start' }),
        createTriggerNode(type, { id: 'trigger' }),
        createNode({ id: 'code', data: { type: BlockEnum.Code, title: '', desc: '' } }),
      ]

      const entry = getWorkflowEntryNode(nodes)
      expect(entry?.id).toBe('trigger')
    },
  )

  it('should return the start node when no trigger node exists', () => {
    const nodes = [
      createStartNode({ id: 'start' }),
      createNode({ id: 'code', data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]

    const entry = getWorkflowEntryNode(nodes)
    expect(entry?.id).toBe('start')
  })

  it('should return undefined when no entry node exists', () => {
    const nodes = [createNode({ id: 'code', data: { type: BlockEnum.Code, title: '', desc: '' } })]

    expect(getWorkflowEntryNode(nodes)).toBeUndefined()
  })
})

describe('isWorkflowEntryNode', () => {
  it('should return true for Start', () => {
    expect(isWorkflowEntryNode(BlockEnum.Start)).toBe(true)
  })

  it.each([BlockEnum.TriggerSchedule, BlockEnum.TriggerWebhook, BlockEnum.TriggerPlugin])(
    'should return true for %s',
    (type) => {
      expect(isWorkflowEntryNode(type)).toBe(true)
    },
  )

  it('should return false for non-entry types', () => {
    expect(isWorkflowEntryNode(BlockEnum.Code)).toBe(false)
    expect(isWorkflowEntryNode(BlockEnum.LLM)).toBe(false)
    expect(isWorkflowEntryNode(BlockEnum.End)).toBe(false)
  })
})

describe('isTriggerWorkflow', () => {
  it('should return true when nodes contain a trigger node', () => {
    const nodes = [createStartNode(), createTriggerNode(BlockEnum.TriggerWebhook)]
    expect(isTriggerWorkflow(nodes)).toBe(true)
  })

  it('should return false when no trigger nodes exist', () => {
    const nodes = [
      createStartNode(),
      createNode({ data: { type: BlockEnum.Code, title: '', desc: '' } }),
    ]
    expect(isTriggerWorkflow(nodes)).toBe(false)
  })

  it('should return false for empty nodes', () => {
    expect(isTriggerWorkflow([])).toBe(false)
  })
})
