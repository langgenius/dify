'use client'

import { memo } from 'react'
import { createContext } from 'use-context-selector'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'

const NoteEditorContext = createContext({})

type NoteEditorContextProviderProps = {
  children: JSX.Element | string | (JSX.Element | string)[]
}
export const NoteEditorContextProvider = memo(({
  children,
}: NoteEditorContextProviderProps) => {
  const initialConfig = {
    namespace: 'note-editor',
    nodes: [
      CodeNode,
    ],
    onError: (error: Error) => {
      throw error
    },
  }

  return (
    <LexicalComposer initialConfig={{ ...initialConfig }}>
      {children}
    </LexicalComposer>
  )
})
NoteEditorContextProvider.displayName = 'NoteEditorContextProvider'

export default NoteEditorContext
