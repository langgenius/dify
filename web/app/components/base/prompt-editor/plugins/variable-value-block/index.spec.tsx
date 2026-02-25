import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { EntityMatch } from '@lexical/text'
import type { LexicalEditor } from 'lexical'
import type { ReactElement } from 'react'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { render } from '@testing-library/react'
import { useLexicalTextEntity } from '../../hooks'
import VariableValueBlock from './index'
import { $createVariableValueBlockNode, VariableValueBlockNode } from './node'

vi.mock('../../hooks')
vi.mock('./node')

const mockHasNodes = vi.fn()

const mockEditor = {
  hasNodes: mockHasNodes,
} as unknown as LexicalEditor

const lexicalContextValue: LexicalComposerContextWithEditor = [
  mockEditor,
  { getTheme: () => undefined },
]

const renderWithLexicalContext = (ui: ReactElement) => {
  return render(
    <LexicalComposerContext.Provider value={lexicalContextValue}>
      {ui}
    </LexicalComposerContext.Provider>,
  )
}

describe('VariableValueBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    vi.mocked($createVariableValueBlockNode).mockImplementation(
      text => ({ createdText: text } as unknown as VariableValueBlockNode),
    )
  })

  it('should render null and register lexical text entity when node is registered', () => {
    const { container } = renderWithLexicalContext(<VariableValueBlock />)

    expect(container.firstChild).toBeNull()
    expect(mockHasNodes).toHaveBeenCalledWith([VariableValueBlockNode])
    expect(useLexicalTextEntity).toHaveBeenCalledWith(
      expect.any(Function),
      VariableValueBlockNode,
      expect.any(Function),
    )
  })

  it('should throw when VariableValueBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => renderWithLexicalContext(<VariableValueBlock />)).toThrow(
      'VariableValueBlockPlugin: VariableValueNode not registered on editor',
    )
  })

  it('should return match offsets when placeholder exists and null when not present', () => {
    renderWithLexicalContext(<VariableValueBlock />)

    const getMatch = vi.mocked(useLexicalTextEntity).mock.calls[0][0] as (text: string) => EntityMatch | null

    const match = getMatch('prefix {{foo_1}} suffix')
    expect(match).toEqual({ start: 7, end: 16 })

    expect(getMatch('prefix without variable')).toBeNull()
  })

  it('should create variable node from text node content in create callback', () => {
    renderWithLexicalContext(<VariableValueBlock />)

    const createNode = vi.mocked(useLexicalTextEntity).mock.calls[0][2] as (
      textNode: { getTextContent: () => string },
    ) => VariableValueBlockNode

    const created = createNode({
      getTextContent: () => '{{account_id}}',
    })

    expect($createVariableValueBlockNode).toHaveBeenCalledWith('{{account_id}}')
    expect(created).toEqual({ createdText: '{{account_id}}' })
  })
})
