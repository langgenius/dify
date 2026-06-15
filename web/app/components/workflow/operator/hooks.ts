import type { NoteNodeType } from '../note-node/types'
import { useLocalStorage } from 'foxact/use-local-storage'
import { useCallback } from 'react'
import { useAppContext } from '@/context/app-context'
import {
  CUSTOM_NOTE_NODE,
  NOTE_SHOW_AUTHOR_STORAGE_KEY,
} from '../note-node/constants'
import { NoteTheme } from '../note-node/types'
import { useWorkflowStore } from '../store'
import { generateNewNode } from '../utils'

export const useOperator = () => {
  const workflowStore = useWorkflowStore()
  const { userProfile } = useAppContext()
  const [showAuthorStorage] = useLocalStorage<string>(NOTE_SHOW_AUTHOR_STORAGE_KEY, 'true', { raw: true })

  const handleAddNote = useCallback(() => {
    const { newNode } = generateNewNode({
      type: CUSTOM_NOTE_NODE,
      data: {
        title: '',
        desc: '',
        type: '' as any,
        text: '',
        theme: NoteTheme.blue,
        author: userProfile?.name || '',
        showAuthor: showAuthorStorage !== 'false',
        width: 240,
        height: 88,
        _isCandidate: true,
      } as NoteNodeType,
      position: {
        x: 0,
        y: 0,
      },
    })
    workflowStore.setState({
      candidateNode: newNode,
    })
  }, [workflowStore, userProfile, showAuthorStorage])

  return {
    handleAddNote,
  }
}
