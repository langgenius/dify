import type {
  Klass,
  LexicalEditor,
  LexicalNode,
} from 'lexical'
import { render, screen } from '@testing-library/react'
import { createEditor } from 'lexical'
import RosterReferenceBlockComponent from '../component'
import {
  $createRosterReferenceBlockNode,
  RosterReferenceBlockNode,
} from '../node'
import {
  getRosterReferenceFileIconType,
  parseRosterReferenceToken,
} from '../utils'

describe('RosterReferenceBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    vi.clearAllMocks()
    editor = createEditor({
      nodes: [RosterReferenceBlockNode as unknown as Klass<LexicalNode>],
    })
  })

  const runInEditor = (callback: () => void) => {
    editor.update(callback, { discrete: true })
  }

  it('should parse roster reference tokens and infer icon classes', () => {
    expect(parseRosterReferenceToken('[§skill:2c3176de8a01:tender-analyzer§]')).toEqual({
      kind: 'skill',
      id: '2c3176de8a01',
      label: 'tender-analyzer',
    })
    expect(parseRosterReferenceToken('[§file:1f0ad3e2:qna_report:final.pdf§]')).toEqual({
      kind: 'file',
      id: '1f0ad3e2',
      label: 'qna_report:final.pdf',
    })
    expect(parseRosterReferenceToken('[§unknown:1:item§]')).toBeNull()
    expect(getRosterReferenceFileIconType('qna_report.pdf')).toBe('pdf')
  })

  it('should render a non-editable token pill component', () => {
    const { container } = render(
      <RosterReferenceBlockComponent text="[§tool-all:tavily/tavily:tavily§]" />,
    )

    const token = screen.getByTitle('tavily')
    expect(token).toHaveAttribute('contenteditable', 'false')
    expect(token).toHaveAttribute('data-roster-reference-kind', 'tool-all')
    expect(token).toHaveAttribute('data-roster-reference-id', 'tavily/tavily')
    expect(token).toHaveClass('border-state-accent-hover-alt')
    expect(token).toHaveClass('bg-state-accent-hover')
    expect(token).toHaveTextContent('tavily')
    expect(container.querySelector('.i-custom-public-other-default-tool-icon')).toBeInTheDocument()
  })

  it('should render knowledge icon with the configured retrieval row style', () => {
    const { container } = render(
      <RosterReferenceBlockComponent text="[§knowledge:manual-1:产品手册§]" />,
    )

    const iconShell = container.querySelector('.bg-util-colors-green-green-500')
    expect(iconShell).toBeInTheDocument()
    expect(iconShell).toHaveClass('text-text-primary-on-surface')
    expect(iconShell?.querySelector('.i-ri-book-open-line')).toBeInTheDocument()
  })

  it('should expose DecoratorNode behavior and preserve raw text content', () => {
    runInEditor(() => {
      const node = new RosterReferenceBlockNode('[§tool-all:tavily/tavily:tavily§]', 'node-key')
      const cloned = RosterReferenceBlockNode.clone(node)
      const dom = node.createDOM()

      expect(RosterReferenceBlockNode.getType()).toBe('roster-reference-block')
      expect(cloned).toBeInstanceOf(RosterReferenceBlockNode)
      expect(cloned.getKey()).toBe('node-key')
      expect(node.isInline()).toBe(true)
      expect(dom).toHaveClass('inline-flex')
      expect(dom).toHaveClass('align-middle')
      expect(node.getTextContent()).toBe('[§tool-all:tavily/tavily:tavily§]')
    })
  })

  it('should import and export serialized node text', () => {
    runInEditor(() => {
      const imported = RosterReferenceBlockNode.importJSON({
        text: '[§knowledge:manual-1:产品手册§]',
        type: 'roster-reference-block',
        version: 1,
      })
      const exported = imported.exportJSON()

      expect(exported).toEqual({
        text: '[§knowledge:manual-1:产品手册§]',
        type: 'roster-reference-block',
        version: 1,
      })
    })
  })

  it('should create node with helper', () => {
    runInEditor(() => {
      const node = $createRosterReferenceBlockNode('[§skill:playwright:Playwright§]')

      expect(node).toBeInstanceOf(RosterReferenceBlockNode)
      expect(node.getTextContent()).toBe('[§skill:playwright:Playwright§]')
    })
  })
})
