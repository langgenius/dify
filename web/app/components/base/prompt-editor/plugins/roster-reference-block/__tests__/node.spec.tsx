import type { Klass, LexicalEditor, LexicalNode } from 'lexical'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEditor } from 'lexical'
import RosterReferenceBlockComponent from '../component'
import { RosterReferenceBlockContext } from '../context'
import { $createRosterReferenceBlockNode, RosterReferenceBlockNode } from '../node'
import { getRosterReferenceFileIconType, parseRosterReferenceToken } from '../utils'

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

  it('should render warning state for missing references', async () => {
    const user = userEvent.setup()
    render(
      <RosterReferenceBlockContext
        value={{
          getWarning: (token) => `${token.label} does not exist`,
        }}
      >
        <RosterReferenceBlockComponent text="[§skill:playwright:Playwright§]" />
      </RosterReferenceBlockContext>,
    )

    const token = screen.getByTitle('Playwright does not exist')
    expect(token).toHaveAttribute('data-roster-reference-warning', 'true')
    expect(token).toHaveClass('border-components-badge-status-light-warning-halo')
    expect(token).toHaveClass('bg-state-warning-hover')
    expect(token).toHaveTextContent('Playwright')
    expect(token.querySelector('.i-ri-alert-fill')).toBeInTheDocument()

    await user.hover(token)
    expect(await screen.findByText('Playwright does not exist')).toBeInTheDocument()
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
