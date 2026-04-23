import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  LoopDurationMap,
  LoopVariableMap,
  NodeTracing,
} from '@/types/workflow'
import { act, renderHook } from '@testing-library/react'
import { BlockEnum } from '../../types'
import { useLogs } from '../hooks'

const createNodeTracing = (id: string): NodeTracing => ({
  id,
  index: 0,
  predecessor_node_id: '',
  node_id: id,
  node_type: BlockEnum.Tool,
  title: id,
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: 'succeeded',
  elapsed_time: 1,
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
  },
  finished_at: 1,
})

const createAgentLog = (id: string, children: AgentLogItemWithChildren[] = []): AgentLogItemWithChildren => ({
  node_execution_id: `execution-${id}`,
  node_id: `node-${id}`,
  parent_id: undefined,
  label: id,
  status: 'success',
  data: {},
  metadata: {},
  message_id: id,
  children,
})

describe('useLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should manage retry, iteration, and loop detail panels', () => {
    const { result } = renderHook(() => useLogs())
    const retryDetail = [createNodeTracing('retry-node')]
    const iterationDetail = [[createNodeTracing('iteration-node')]]
    const loopDetail = [[createNodeTracing('loop-node')]]
    const iterationDurationMap: IterationDurationMap = { 'iteration-node': 2 }
    const loopDurationMap: LoopDurationMap = { 'loop-node': 3 }
    const loopVariableMap: LoopVariableMap = { 'loop-node': { item: 'value' } }

    expect(result.current.showSpecialResultPanel).toBe(false)

    act(() => {
      result.current.handleShowRetryResultList(retryDetail)
    })

    expect(result.current.showRetryDetail).toBe(true)
    expect(result.current.retryResultList).toEqual(retryDetail)
    expect(result.current.showSpecialResultPanel).toBe(true)

    act(() => {
      result.current.setShowRetryDetailFalse()
      result.current.handleShowIterationResultList(iterationDetail, iterationDurationMap)
      result.current.handleShowLoopResultList(loopDetail, loopDurationMap, loopVariableMap)
    })

    expect(result.current.showRetryDetail).toBe(false)
    expect(result.current.showIteratingDetail).toBe(true)
    expect(result.current.iterationResultList).toEqual(iterationDetail)
    expect(result.current.iterationResultDurationMap).toEqual(iterationDurationMap)
    expect(result.current.showLoopingDetail).toBe(true)
    expect(result.current.loopResultList).toEqual(loopDetail)
    expect(result.current.loopResultDurationMap).toEqual(loopDurationMap)
    expect(result.current.loopResultVariableMap).toEqual(loopVariableMap)
  })

  it('should push, trim, and clear agent/tool log navigation state', () => {
    const { result } = renderHook(() => useLogs())
    const childLog = createAgentLog('child-log')
    const rootLog = createAgentLog('root-log', [childLog])
    const siblingLog = createAgentLog('sibling-log')

    act(() => {
      result.current.handleShowAgentOrToolLog(rootLog)
    })

    expect(result.current.agentOrToolLogItemStack).toEqual([rootLog])
    expect(result.current.agentOrToolLogListMap).toEqual({
      'root-log': [childLog],
    })
    expect(result.current.showSpecialResultPanel).toBe(true)

    act(() => {
      result.current.handleShowAgentOrToolLog(siblingLog)
    })

    expect(result.current.agentOrToolLogItemStack).toEqual([rootLog, siblingLog])

    act(() => {
      result.current.handleShowAgentOrToolLog(rootLog)
    })

    expect(result.current.agentOrToolLogItemStack).toEqual([rootLog])

    act(() => {
      result.current.handleShowAgentOrToolLog(undefined)
    })

    expect(result.current.agentOrToolLogItemStack).toEqual([])
  })
})
