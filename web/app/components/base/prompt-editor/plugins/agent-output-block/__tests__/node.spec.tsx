import type {
  Klass,
  LexicalEditor,
  LexicalNode,
} from 'lexical'
import { createEditor } from 'lexical'
import {
  $createAgentOutputBlockNode,
  $isAgentOutputBlockNode,
  AgentOutputBlockNode,
} from '../node'
import {
  getAgentOutputToken,
  parseAgentOutputToken,
} from '../utils'

describe('AgentOutputBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [AgentOutputBlockNode as unknown as Klass<LexicalNode>],
    })
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should persist output tokens with bracket wrappers', () => {
    runInEditor(() => {
      const node = $createAgentOutputBlockNode('summary', 'string')

      expect(node.getTextContent()).toBe('[§output:summary:summary§]')
      expect(getAgentOutputToken('summary')).toBe('[§output:summary:summary§]')
    })
  })

  it('should parse bracketed output tokens and legacy bare tokens', () => {
    expect(parseAgentOutputToken('before [§output:summary:summary§] after')).toEqual({
      name: 'summary',
      start: 7,
      end: 33,
    })
    expect(parseAgentOutputToken('before §output:summary:summary§ after')).toEqual({
      name: 'summary',
      start: 7,
      end: 31,
    })
    expect(parseAgentOutputToken('[§skill:summary:summary§]')).toBeNull()
  })

  it('should create node with helper and support type guard checks', () => {
    runInEditor(() => {
      const node = $createAgentOutputBlockNode('result', 'object')

      expect(node).toBeInstanceOf(AgentOutputBlockNode)
      expect(node.getTextContent()).toBe('[§output:result:result§]')
      expect($isAgentOutputBlockNode(node)).toBe(true)
      expect($isAgentOutputBlockNode(null)).toBe(false)
      expect($isAgentOutputBlockNode(undefined)).toBe(false)
      expect($isAgentOutputBlockNode({} as LexicalNode)).toBe(false)
    })
  })
})
