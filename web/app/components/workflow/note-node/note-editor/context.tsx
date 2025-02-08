'use client'

import {
  createContext,
  memo,
  useRef,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { LinkNode } from '@lexical/link'
import {
  ListItemNode,
  ListNode,
} from '@lexical/list'
import { createNoteEditorStore } from './store'
import theme from './theme'

type NoteEditorStore = ReturnType<typeof createNoteEditorStore>
const NoteEditorContext = createContext<NoteEditorStore | null>(null)

type NoteEditorContextProviderProps = {
  value: string
  children: React.JSX.Element | string | (React.JSX.Element | string)[]
}
export const NoteEditorContextProvider = memo(({
  value,
  children,
}: NoteEditorContextProviderProps) => {
  const storeRef = useRef<NoteEditorStore>()

  if (!storeRef.current)
    storeRef.current = createNoteEditorStore()

  let initialValue = null
  try {
    initialValue = JSON.parse(value)
  }
  catch (e) {

  }

  const initialConfig = {
    namespace: 'note-editor',
    nodes: [
      LinkNode,
      ListNode,
      ListItemNode,
    ],
    editorState: !initialValue?.root.children.length ? null : JSON.stringify(initialValue),
    onError: (error: Error) => {
      throw error
    },
    theme,
  }

  return (
    <NoteEditorContext.Provider value={storeRef.current}>
      <LexicalComposer initialConfig={{ ...initialConfig }}>
        {children}
      </LexicalComposer>
    </NoteEditorContext.Provider>
  )
})
NoteEditorContextProvider.displayName = 'NoteEditorContextProvider'

export default NoteEditorContext
