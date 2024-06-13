import { useCallback } from 'react'
import { generateNewNode } from '../utils'
import { useWorkflowStore } from '../store'
import type { NoteNodeType } from '../note-node/types'
import { CUSTOM_NOTE_NODE } from '../note-node/constants'
import { NoteTheme } from '../note-node/types'
import { useAppContext } from '@/context/app-context'

export const useOperator = () => {
  const workflowStore = useWorkflowStore()
  const { userProfile } = useAppContext()

  const handleAddNote = useCallback(() => {
    const newNode = generateNewNode({
      type: CUSTOM_NOTE_NODE,
      data: {
        title: '',
        desc: '',
        type: '' as any,
        text: '',
        theme: NoteTheme.blue,
        author: userProfile?.name || '',
        showAuthor: true,
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
