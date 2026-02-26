import type { Edge, Node } from '../types'
import { vi } from 'vitest'
import { writeTextToClipboard } from '@/utils/clipboard'
import { BlockEnum } from '../types'
import {
  parseWorkflowClipboardData,
  readWorkflowClipboardData,
  serializeWorkflowClipboardData,
  writeWorkflowClipboardData,
} from './workflow-clipboard'

vi.mock('@/utils/clipboard', () => ({
  writeTextToClipboard: vi.fn(),
}))

const createNode = (id: string): Node => {
  return {
    id,
    type: 'custom',
    position: { x: 0, y: 0 },
    data: {
      type: BlockEnum.Code,
      title: 'Code',
      desc: '',
    },
  } as Node
}

const createEdge = (): Edge => {
  return {
    id: 'edge-1',
    source: 'node-1',
    target: 'node-2',
    data: {
      sourceType: BlockEnum.Code,
      targetType: BlockEnum.Code,
    },
  } as Edge
}

describe('workflow clipboard utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should serialize and parse workflow clipboard data', () => {
    const node = createNode('node-1')
    const edge = createEdge()
    const serialized = serializeWorkflowClipboardData({
      nodes: [node],
      relatedNodes: [node],
      relatedEdges: [edge],
    })

    const parsed = parseWorkflowClipboardData(serialized)

    expect(parsed).toEqual({
      dataType: 'dify/workflow',
      version: 1,
      nodes: [node],
      relatedNodes: [node],
      relatedEdges: [edge],
    })
  })

  it('should return null for invalid clipboard text', () => {
    expect(parseWorkflowClipboardData('invalid json')).toBeNull()
  })

  it('should return null for non-workflow clipboard text', () => {
    const text = JSON.stringify({
      dataType: 'not-dify-workflow',
      version: 1,
      nodes: [],
    })

    expect(parseWorkflowClipboardData(text)).toBeNull()
  })

  it('should write serialized workflow data to clipboard', async () => {
    const node = createNode('node-1')

    await writeWorkflowClipboardData({
      nodes: [node],
      relatedNodes: [node],
      relatedEdges: [],
    })

    expect(writeTextToClipboard).toHaveBeenCalledWith(
      JSON.stringify({
        dataType: 'dify/workflow',
        version: 1,
        nodes: [node],
        relatedNodes: [node],
        relatedEdges: [],
      }),
    )
  })

  it('should read and parse workflow clipboard data', async () => {
    const node = createNode('node-1')
    const readText = vi.fn().mockResolvedValue(JSON.stringify({
      dataType: 'dify/workflow',
      version: 1,
      nodes: [node],
    }))

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    })

    const result = await readWorkflowClipboardData()

    expect(result).toEqual({
      dataType: 'dify/workflow',
      version: 1,
      nodes: [node],
    })
  })
})
