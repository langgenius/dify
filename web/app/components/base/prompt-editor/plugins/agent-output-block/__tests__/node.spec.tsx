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
  inferAgentOutputType,
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

      expect(newEditingNode.shouldSelectNameOnEdit()).toBe(true)
      expect(existingEditingNode.shouldSelectNameOnEdit()).toBe(false)
    })
  })

  it('should persist and parse file-name output tokens', () => {
    runInEditor(() => {
      const node = $createAgentOutputBlockNode('qna_report.pdf', 'file')

      expect(node.getTextContent()).toBe('[§output:qna_report.pdf:qna_report.pdf§]')
      expect(getAgentOutputToken('qna_report.pdf')).toBe('[§output:qna_report.pdf:qna_report.pdf§]')
    })

    expect(parseAgentOutputToken('Use [§output:qna_report.pdf:qna_report.pdf§]')).toEqual({
      name: 'qna_report.pdf',
      start: 4,
      end: 44,
    })
  })

  it('should infer file type only for whitelisted file extensions', () => {
    expect(inferAgentOutputType('qna_report.pdf', 'string')).toBe('file')
    expect(inferAgentOutputType('QNA_REPORT.PDF', 'string')).toBe('file')
    expect(inferAgentOutputType('report.customext', 'string')).toBe('string')
    expect(inferAgentOutputType('report.customext', 'object')).toBe('object')
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
    expect([...extractAgentOutputNames('A [§output:summary:summary§] B §output:qna_report.pdf:qna_report.pdf§')]).toEqual([
      'summary',
      'qna_report.pdf',
    ])
  })

  it('should replace only matching output token names', () => {
    expect(replaceAgentOutputName(
      'Use [§output:summary:summary§] and §output:other:other§',
      'summary',
      'final_summary',
    )).toBe('Use [§output:final_summary:final_summary§] and §output:other:other§')
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
