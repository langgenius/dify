'use client'

import {
  createContext,
  memo,
  useRef,
} from 'react'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { LinkNode } from '@lexical/link'
import { createNoteEditorStore } from './store'

type NoteEditorStore = ReturnType<typeof createNoteEditorStore>
const NoteEditorContext = createContext<NoteEditorStore | null>(null)

type NoteEditorContextProviderProps = {
  children: JSX.Element | string | (JSX.Element | string)[]
}
export const NoteEditorContextProvider = memo(({
  children,
}: NoteEditorContextProviderProps) => {
  const storeRef = useRef<NoteEditorStore>()

  if (!storeRef.current)
    storeRef.current = createNoteEditorStore()

  const initialConfig = {
    namespace: 'note-editor',
    nodes: [
      CodeNode,
      LinkNode,
    ],
    onError: (error: Error) => {
      throw error
    },
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
