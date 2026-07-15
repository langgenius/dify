import type { SnippetInputField } from '@/models/snippet'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSnippetDraftStore } from '../../draft-store'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'

type UseSnippetInputFieldActionsOptions = {
  canEdit?: boolean
  snippetId: string
}

export const useSnippetInputFieldActions = ({
  canEdit = true,
  snippetId,
}: UseSnippetInputFieldActionsOptions) => {
  const { syncInputFieldsDraft } = useNodesSyncDraft(snippetId)
  const { inputFields, setInputFields } = useSnippetDraftStore(
    useShallow((state) => ({
      inputFields: state.inputFields,
      setInputFields: state.setInputFields,
    })),
  )

  const handleFieldsChange = useCallback(
    (newFields: SnippetInputField[]) => {
      if (!canEdit) return

      setInputFields(newFields)
      void syncInputFieldsDraft(newFields, {
        onRefresh: setInputFields,
      })
    },
    [canEdit, setInputFields, syncInputFieldsDraft],
  )

  return {
    fields: inputFields,
    handleFieldsChange,
  }
}
