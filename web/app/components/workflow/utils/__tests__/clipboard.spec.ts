import { createEdge, createNode } from '../../__tests__/fixtures'
import {
  parseWorkflowClipboardText,
  readWorkflowClipboard,
  stringifyWorkflowClipboardData,
  writeWorkflowClipboard,
} from '../clipboard'

describe('workflow clipboard storage', () => {
  const readTextMock = vi.fn<() => Promise<string>>()
  const writeTextMock = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    readTextMock.mockReset()
    writeTextMock.mockReset()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: readTextMock,
        writeText: writeTextMock,
      },
    })
  })

  it('should return empty clipboard data when clipboard text is empty', async () => {
    readTextMock.mockResolvedValue('')

    await expect(readWorkflowClipboard()).resolves.toEqual({
      nodes: [],
      edges: [],
      isVersionMismatch: false,
    })
  })

  it('should write and read clipboard data', async () => {
    const nodes = [createNode({ id: 'node-1' })]
    const edges = [createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })]

    const serialized = stringifyWorkflowClipboardData({ nodes, edges })
    readTextMock.mockResolvedValue(serialized)

    await writeWorkflowClipboard({ nodes, edges })
    expect(writeTextMock).toHaveBeenCalledWith(serialized)
    await expect(readWorkflowClipboard()).resolves.toEqual({
      nodes,
      edges,
      sourceVersion: 1,
      isVersionMismatch: false,
    })
  })

  it('should allow reading clipboard data with different version', async () => {
    const nodes = [createNode({ id: 'node-1' })]
    const edges = [createEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })]
    readTextMock.mockResolvedValue(JSON.stringify({
      kind: 'dify-workflow-clipboard',
      version: 2,
      nodes,
      edges,
    }))

    await expect(readWorkflowClipboard()).resolves.toEqual({
      nodes,
      edges,
      sourceVersion: 2,
      isVersionMismatch: true,
    })
  })

  it('should return empty clipboard data for invalid JSON', () => {
    expect(parseWorkflowClipboardText('{invalid-json')).toEqual({
      nodes: [],
      edges: [],
      isVersionMismatch: false,
    })
  })

  it('should return empty clipboard data for invalid structure', () => {
    expect(parseWorkflowClipboardText(JSON.stringify({
      kind: 'unknown',
      version: 1,
      nodes: [],
      edges: [],
    }))).toEqual({
      nodes: [],
      edges: [],
      isVersionMismatch: false,
    })
  })

  it('should return empty clipboard data when clipboard read fails', async () => {
    readTextMock.mockRejectedValue(new Error('clipboard denied'))

    await expect(readWorkflowClipboard()).resolves.toEqual({
      nodes: [],
      edges: [],
      isVersionMismatch: false,
    })
  })
})
