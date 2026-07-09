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
  extractAgentOutputNames,
  getAgentOutputToken,
  parseAgentOutputToken,
  replaceAgentOutputName,
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

  it('should select the output name only for newly inserted editing nodes', () => {
    runInEditor(() => {
      const newEditingNode = $createAgentOutputBlockNode('output', 'string', true)
      const existingEditingNode = $createAgentOutputBlockNode('summary', 'string', true, [], undefined, undefined, false)
      const typeSelectingNode = $createAgentOutputBlockNode('summary', 'string', true, [], undefined, undefined, false, true)

      expect(newEditingNode.shouldSelectNameOnEdit()).toBe(true)
      expect(existingEditingNode.shouldSelectNameOnEdit()).toBe(false)
      expect(typeSelectingNode.shouldOpenTypeSelectOnEdit()).toBe(true)
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

  it('should extract output names from bracketed and legacy tokens', () => {
    expect([...extractAgentOutputNames('A [§output:summary:summary§] B §output:final_summary:final_summary§')]).toEqual([
      'summary',
      'final_summary',
    ])
  })

  it('should replace only matching output token names', () => {
    expect(replaceAgentOutputName(
      'Use [§output:summary:summary§] and §output:other:other§',
      'summary',
      'final_summary',
    )).toBe('Use [§output:final_summary:final_summary§] and §output:other:other§')
    expect(replaceAgentOutputName(
      'Generate [§output:output:output§] and §output:output:output§',
      'output',
      'summary',
    )).toBe('Generate [§output:summary:summary§] and §output:summary:summary§')
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
