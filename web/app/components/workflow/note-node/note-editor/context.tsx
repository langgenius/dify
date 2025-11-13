'use client'

import {
  createContext,
  memo,
  useEffect,
  useRef,
} from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { LinkNode } from '@lexical/link'
import {
  ListItemNode,
  ListNode,
} from '@lexical/list'
import { $getRoot } from 'lexical'
import { createNoteEditorStore } from './store'
import theme from './theme'

const NoteEditorContentSynchronizer = ({ value }: { value?: string }) => {
  const [editor] = useLexicalComposerContext()
  const lastSyncedValueRef = useRef<string | null>(null)

  useEffect(() => {
    const normalizedValue = normalizeEditorState(value)
    if (normalizedValue === lastSyncedValueRef.current)
      return

    const currentSerializedState = JSON.stringify(editor.getEditorState().toJSON())
    if (normalizedValue === currentSerializedState) {
      lastSyncedValueRef.current = normalizedValue
      return
    }

    if (!normalizedValue) {
      let hasContent = false
      editor.getEditorState().read(() => {
        hasContent = !$getRoot().isEmpty()
      })

      if (!hasContent) {
        lastSyncedValueRef.current = normalizedValue
        return
      }

      editor.update(() => {
        const root = $getRoot()
        root.clear()
        root.select()
      })
      lastSyncedValueRef.current = normalizedValue
      return
    }

    try {
      const nextState = editor.parseEditorState(normalizedValue)
      editor.setEditorState(nextState)
      lastSyncedValueRef.current = normalizedValue
    }
    catch {
      lastSyncedValueRef.current = ''
    }
  }, [editor, value])

  return null
}

type NoteEditorStore = ReturnType<typeof createNoteEditorStore>
const NoteEditorContext = createContext<NoteEditorStore | null>(null)

type NoteEditorContextProviderProps = {
  value?: string
  children: React.JSX.Element | string | (React.JSX.Element | string)[]
  editable?: boolean
}
export const NoteEditorContextProvider = memo(({
  value,
  children,
  editable = true,
}: NoteEditorContextProviderProps) => {
  const storeRef = useRef<NoteEditorStore | undefined>(undefined)

  if (!storeRef.current)
    storeRef.current = createNoteEditorStore()

  let initialValue = null
  try {
    if (value)
      initialValue = JSON.parse(value)
  }
  catch {

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
    editable,
  }

  return (
    <NoteEditorContext.Provider value={storeRef.current}>
      <LexicalComposer initialConfig={{ ...initialConfig }}>
        <NoteEditorContentSynchronizer value={value} />
        {children}
      </LexicalComposer>
    </NoteEditorContext.Provider>
  )
})
NoteEditorContextProvider.displayName = 'NoteEditorContextProvider'

export default NoteEditorContext

function normalizeEditorState(value?: string): string {
  if (!value)
    return ''

  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || !parsed.root)
      return ''

    return JSON.stringify(parsed)
  }
  catch {
    return ''
  }
}
