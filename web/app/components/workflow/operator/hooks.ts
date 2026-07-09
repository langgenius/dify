import type { NoteNodeType } from '../note-node/types'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { userProfileAtom } from '@/context/app-context-state'
import {
  CUSTOM_NOTE_NODE,
} from '../note-node/constants'
import { NoteTheme } from '../note-node/types'
import { useWorkflowNoteShowAuthorValue } from '../persistence/local-storage-options'
import { useWorkflowStore } from '../store'
import { generateNewNode } from '../utils'

export const useOperator = () => {
  const workflowStore = useWorkflowStore()
  const userProfile = useAtomValue(userProfileAtom)
  const showAuthorStorage = useWorkflowNoteShowAuthorValue()

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
