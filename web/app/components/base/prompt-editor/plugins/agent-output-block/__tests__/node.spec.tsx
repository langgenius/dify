import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical'
import { createLexicalTestEditor, readRootTextContent } from '../../__tests__/test-helpers'
import { $createAgentOutputBlockNode, AgentOutputBlockNode } from '../node'
import { extractAgentOutputNames, parseAgentOutputToken, replaceAgentOutputName } from '../utils'

describe('AgentOutputBlockNode', () => {
  it('persists the output name and type through editor serialization without transient editing state', () => {
    const editor = createLexicalTestEditor('agent-output', [AgentOutputBlockNode])
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createAgentOutputBlockNode('summary', 'object', true)),
        )
      },
      { discrete: true },
    )
    const saved = editor.getEditorState().toJSON()
    expect(saved.root.children[0]).toMatchObject({
      children: [{ type: 'agent-output-block', version: 1, name: 'summary', outputType: 'object' }],
    })
    const restored = createLexicalTestEditor('restored-agent-output', [AgentOutputBlockNode])
    restored.setEditorState(restored.parseEditorState(JSON.stringify(saved)))
    expect(readRootTextContent(restored)).toBe('[§output:summary:summary§]')
    restored.getEditorState().read(() => {
      const [node] = $nodesOfType(AgentOutputBlockNode)
      expect(node!.getOutputType()).toBe('object')
      expect(node!.isEditing()).toBe(false)
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
    expect([
      ...extractAgentOutputNames(
        'A [§output:summary:summary§] B §output:final_summary:final_summary§',
      ),
    ]).toEqual(['summary', 'final_summary'])
  })

  it('should replace only matching output token names', () => {
    expect(
      replaceAgentOutputName(
        'Use [§output:summary:summary§] and §output:other:other§',
        'summary',
        'final_summary',
      ),
    ).toBe('Use [§output:final_summary:final_summary§] and §output:other:other§')
    expect(
      replaceAgentOutputName(
        'Generate [§output:output:output§] and §output:output:output§',
        'output',
        'summary',
      ),
    ).toBe('Generate [§output:summary:summary§] and §output:summary:summary§')
  })
})
