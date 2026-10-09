import type { Props as EditorProps } from '..'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useEffectEvent, useRef } from 'react'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { VarType } from '@/app/components/workflow/types'
import CodeEditor from '../editor-support-vars'

vi.mock('..', () => ({
  default: function MockEditor({ onMount }: EditorProps) {
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const cursorListenerRef = useRef<((event: unknown) => void) | undefined>(undefined)
    const mountEditor = useEffectEvent(() => {
      const input = inputRef.current!
      onMount?.(
        {
          getDomNode: () => input,
          getModel: () => ({ getLineContent: () => input.value }),
          getPosition: () => ({ lineNumber: 1, column: input.value.length + 1 }),
          getScrolledVisiblePosition: () => ({ left: 0, top: 0 }),
          onDidChangeCursorPosition: (listener: (event: unknown) => void) => {
            cursorListenerRef.current = listener
          },
          executeEdits: (_source: string, edits: { text: string }[]) => {
            input.value = edits[0]!.text
          },
        },
        { Range: class {} },
      )
    })
    useEffect(() => mountEditor(), [])
    return (
      <textarea
        ref={inputRef}
        aria-label="Code"
        onInput={(event) => {
          cursorListenerRef.current?.({
            position: { lineNumber: 1, column: event.currentTarget.value.length + 1 },
          })
        }}
      />
    )
  },
}))

describe('code editor variable completion', () => {
  it('keeps variable navigation on its editor and inserts the selected variable', async () => {
    const user = userEvent.setup()
    const onAddVar = vi.fn()
    render(
      <>
        <input aria-label="Outside" />
        <CodeEditor
          language={CodeLanguage.python3}
          varList={[]}
          onAddVar={onAddVar}
          availableVars={[
            {
              nodeId: 'source',
              title: 'Source',
              vars: [
                { variable: 'first', type: VarType.string },
                { variable: 'second', type: VarType.string },
              ],
            },
          ]}
        />
      </>,
    )

    const editor = screen.getByRole('textbox', { name: 'Code' })
    await user.type(editor, '/')
    expect(screen.getByText('first')).toBeInTheDocument()
    await user.click(screen.getByRole('textbox', { name: 'Outside' }))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onAddVar).not.toHaveBeenCalled()
    await user.click(editor)
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onAddVar).toHaveBeenCalledWith({
      variable: 'second',
      value_selector: ['source', 'second'],
    })
    expect(editor).toHaveValue('{{ second }}')
    expect(screen.queryByText('second')).not.toBeInTheDocument()
  })
})
