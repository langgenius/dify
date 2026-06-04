import type { SnippetInputField } from '@/models/snippet'
import { useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useSnippetDetailStore } from '../../store'

type UseSnippetInputFieldActionsOptions = {
  snippetId: string
}

export const useSnippetInputFieldActions = ({
  snippetId,
}: UseSnippetInputFieldActionsOptions) => {
  const { syncInputFieldsDraft } = useNodesSyncDraft(snippetId)
  const {
    fields,
    setFields,
  } = useSnippetDetailStore(useShallow(state => ({
    fields: state.fields,
    setFields: state.setFields,
  })))

  const handleFieldsChange = useCallback((newFields: SnippetInputField[]) => {
    setFields(newFields)
    void syncInputFieldsDraft(newFields, {
      onRefresh: setFields,
    })
  }, [setFields, syncInputFieldsDraft])

  return {
    fields,
    handleFieldsChange,
  }
}
