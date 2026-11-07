import type { LexicalEditor } from 'lexical'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import RosterReferenceBlockComponent from '../component'
import { RosterReferenceBlockContext } from '../context'
import { $createRosterReferenceBlockNode, RosterReferenceBlockNode } from '../node'
import { getRosterReferenceFileIconType, parseRosterReferenceToken } from '../utils'

describe('RosterReferenceBlockNode', () => {
  let editor: LexicalEditor

  beforeEach(() => {
    editor = createEditor({
      nodes: [RosterReferenceBlockNode],
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

    const token = screen.getByText('Playwright').closest<HTMLElement>('[contenteditable="false"]')!
    expect(token).toHaveAttribute('data-roster-reference-warning', 'true')
    expect(token).toHaveTextContent('Playwright')

    await user.hover(token)
    expect(await screen.findByText('Playwright does not exist')).toBeVisible()
  })

  it('preserves a reference token when saving and restoring editor state', () => {
    const text = '[§knowledge:manual-1:产品手册§]'
    runInEditor(() =>
      $getRoot().append($createParagraphNode().append($createRosterReferenceBlockNode(text))),
    )
    const saved = editor.getEditorState().toJSON()
    expect(saved.root.children[0]).toMatchObject({
      children: [{ type: 'roster-reference-block', version: 1, text }],
    })
    const restored = createEditor({ nodes: [RosterReferenceBlockNode] })
    restored.setEditorState(restored.parseEditorState(saved))
    restored.getEditorState().read(() => expect($getRoot().getTextContent()).toBe(text))
  })
})
