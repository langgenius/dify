import type { NoteNodeType } from '@/app/components/workflow/note-node/types'
import { useCallback } from 'react'
import { useAppContext } from '@/context/app-context'
import {
  CUSTOM_NOTE_NODE,
  NOTE_SHOW_AUTHOR_STORAGE_KEY,
} from '@/app/components/workflow/note-node/constants'
import { NoteTheme } from '@/app/components/workflow/note-node/types'
import { useWorkflowStore } from '@/app/components/workflow/store/index'
import { generateNewNode } from '@/app/components/workflow/utils/index'

export const useOperator = () => {
  const workflowStore = useWorkflowStore()
  const { userProfile } = useAppContext()

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
        showAuthor: localStorage.getItem(NOTE_SHOW_AUTHOR_STORAGE_KEY) !== 'false',
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
  }, [workflowStore, userProfile])

  return {
    handleAddNote,
  }
}
