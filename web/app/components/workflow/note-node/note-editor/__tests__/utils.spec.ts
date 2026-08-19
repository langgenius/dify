import type { TextNode } from 'lexical'
import { getSelectedNode, urlRegExp } from '../utils'

const mockIsAtNodeEnd = vi.hoisted(() => vi.fn())

vi.mock('@lexical/selection', () => ({
  $isAtNodeEnd: (...args: unknown[]) => mockIsAtNodeEnd(...args),
}))

describe('note editor utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the shared node directly when anchor and focus point to the same node', () => {
    const node = { key: 'same-node' } as unknown as TextNode
    const selection = {
      anchor: { getNode: () => node },
      focus: { getNode: () => node },
      isBackward: () => false,
    } as never

    expect(getSelectedNode(selection)).toBe(node)
  })

  it('chooses the focus node when selecting backward from the middle of the node', () => {
    const anchorNode = { key: 'anchor' } as unknown as TextNode
    const focusNode = { key: 'focus' } as unknown as TextNode
    mockIsAtNodeEnd.mockReturnValue(false)
    const selection = {
      anchor: { getNode: () => anchorNode },
      focus: { getNode: () => focusNode },
      isBackward: () => true,
    } as never

    expect(getSelectedNode(selection)).toBe(focusNode)
    expect(urlRegExp.test('https://dify.ai/docs')).toBe(true)
  })
})
