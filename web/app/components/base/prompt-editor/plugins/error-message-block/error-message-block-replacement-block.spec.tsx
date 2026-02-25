import type { LexicalComposerContextWithEditor } from '@lexical/react/LexicalComposerContext'
import type { EntityMatch } from '@lexical/text'
import type { LexicalEditor, LexicalNode } from 'lexical'
import type { ReactElement } from 'react'
import { LexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { mergeRegister } from '@lexical/utils'
import { render } from '@testing-library/react'
import { $applyNodeReplacement } from 'lexical'
import { ERROR_MESSAGE_PLACEHOLDER_TEXT } from '../../constants'
import { decoratorTransform } from '../../utils'
import { CustomTextNode } from '../custom-text/node'
import ErrorMessageBlockReplacementBlock from './error-message-block-replacement-block'
import { $createErrorMessageBlockNode, ErrorMessageBlockNode } from './node'

vi.mock('@lexical/utils')
vi.mock('lexical')
vi.mock('../../utils')
vi.mock('./node')

const mockHasNodes = vi.fn()
const mockRegisterNodeTransform = vi.fn()

const mockEditor = {
  hasNodes: mockHasNodes,
  registerNodeTransform: mockRegisterNodeTransform,
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

describe('ErrorMessageBlockReplacementBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasNodes.mockReturnValue(true)
    mockRegisterNodeTransform.mockReturnValue(vi.fn())
    vi.mocked(mergeRegister).mockImplementation((...cleanups) => {
      return () => cleanups.forEach(cleanup => cleanup())
    })
    vi.mocked($createErrorMessageBlockNode).mockReturnValue({ type: 'node' } as unknown as ErrorMessageBlockNode)
    vi.mocked($applyNodeReplacement).mockImplementation((node: LexicalNode) => node)
  })

  it('should register transform and cleanup on unmount', () => {
    const transformCleanup = vi.fn()
    mockRegisterNodeTransform.mockReturnValue(transformCleanup)

    const { unmount, container } = renderWithLexicalContext(<ErrorMessageBlockReplacementBlock />)

    expect(container.firstChild).toBeNull()
    expect(mockHasNodes).toHaveBeenCalledWith([ErrorMessageBlockNode])
    expect(mockRegisterNodeTransform).toHaveBeenCalledWith(CustomTextNode, expect.any(Function))

    unmount()
    expect(transformCleanup).toHaveBeenCalled()
  })

  it('should throw when ErrorMessageBlockNode is not registered', () => {
    mockHasNodes.mockReturnValue(false)

    expect(() => renderWithLexicalContext(<ErrorMessageBlockReplacementBlock />)).toThrow(
      'ErrorMessageBlockNodePlugin: ErrorMessageBlockNode not registered on editor',
    )
  })

  it('should pass matcher and creator to decoratorTransform and match placeholder text', () => {
    renderWithLexicalContext(<ErrorMessageBlockReplacementBlock />)

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    const textNode = { id: 't-1' } as unknown as LexicalNode
    transformCallback(textNode)

    expect(decoratorTransform).toHaveBeenCalledWith(
      textNode,
      expect.any(Function),
      expect.any(Function),
    )

    const getMatch = vi.mocked(decoratorTransform).mock.calls[0][1] as (text: string) => EntityMatch | null
    const match = getMatch(`hello ${ERROR_MESSAGE_PLACEHOLDER_TEXT} world`)

    expect(match).toEqual({
      start: 6,
      end: 6 + ERROR_MESSAGE_PLACEHOLDER_TEXT.length,
    })
    expect(getMatch('hello world')).toBeNull()
  })

  it('should create replacement node and call onInsert when creator runs', () => {
    const onInsert = vi.fn()
    renderWithLexicalContext(<ErrorMessageBlockReplacementBlock onInsert={onInsert} />)

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    transformCallback({ id: 't-1' } as unknown as LexicalNode)

    const createNode = vi.mocked(decoratorTransform).mock.calls[0][2] as () => ErrorMessageBlockNode
    const created = createNode()

    expect(onInsert).toHaveBeenCalledTimes(1)
    expect($createErrorMessageBlockNode).toHaveBeenCalledTimes(1)
    expect($applyNodeReplacement).toHaveBeenCalledWith({ type: 'node' })
    expect(created).toEqual({ type: 'node' })
  })

  it('should create replacement node without onInsert callback', () => {
    renderWithLexicalContext(<ErrorMessageBlockReplacementBlock />)

    const transformCallback = mockRegisterNodeTransform.mock.calls[0][1] as (node: LexicalNode) => void
    transformCallback({ id: 't-1' } as unknown as LexicalNode)

    const createNode = vi.mocked(decoratorTransform).mock.calls[0][2] as () => ErrorMessageBlockNode

    expect(() => createNode()).not.toThrow()
    expect($createErrorMessageBlockNode).toHaveBeenCalled()
  })
})
