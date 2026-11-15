import type { HotkeyChord } from '@tanstack/react-hotkeys'
import type { ShortcutPopupDisplayMode } from '../index'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { CONTROLLED_TEXT_INSERTION_COMMAND } from 'lexical'
import { useState } from 'react'
import { TestLexicalComposer } from '@/test/lexical'
import ShortcutsPopupPlugin from '../index'

export function PopupEditor({
  withContainer = true,
  hotkey,
  displayMode,
  withActions = true,
}: {
  withContainer?: boolean
  hotkey?: HotkeyChord
  displayMode?: ShortcutPopupDisplayMode
  withActions?: boolean
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <TestLexicalComposer
      initialConfig={{
        namespace: 'shortcut-browser',
        onError: (error) => {
          throw error
        },
      }}
    >
      <label>
        Outside
        <input aria-label="Outside" />
      </label>
      <div
        ref={withContainer ? setContainer : undefined}
        style={{ position: 'relative', margin: 32, width: 480 }}
      >
        <RichTextPlugin
          contentEditable={<ContentEditable aria-label="Prompt" className="min-h-20 border p-2" />}
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ShortcutsPopupPlugin
          container={withContainer ? container : undefined}
          hotkey={hotkey}
          displayMode={displayMode}
        >
          {withActions
            ? (close, onInsert) => (
                <section aria-label="Prompt actions" style={{ width: 240, padding: 16 }}>
                  <button
                    type="button"
                    onClick={() => onInsert(CONTROLLED_TEXT_INSERTION_COMMAND, 'inserted text')}
                  >
                    Insert
                  </button>
                  <button type="button" onClick={close}>
                    Close actions
                  </button>
                  <Popover>
                    <PopoverTrigger>Details</PopoverTrigger>
                    <PopoverContent>
                      <button type="button">Nested action</button>
                    </PopoverContent>
                  </Popover>
                </section>
              )
            : undefined}
        </ShortcutsPopupPlugin>
      </div>
    </TestLexicalComposer>
  )
}
