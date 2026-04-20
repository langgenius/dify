import type { SnippetInputField } from '@/models/snippet'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useSnippetDetailStore } from '../../store'

type UseSnippetInputFieldActionsOptions = {
  snippetId: string
}

export const useSnippetInputFieldActions = ({
  snippetId,
}: UseSnippetInputFieldActionsOptions) => {
  const { t } = useTranslation('snippet')
  const { syncInputFieldsDraft } = useNodesSyncDraft(snippetId)
  const {
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    closeEditor,
    openEditor,
    setFields,
    setInputPanelOpen,
    toggleInputPanel,
  } = useSnippetDetailStore(useShallow(state => ({
    editingField: state.editingField,
    fields: state.fields,
    isEditorOpen: state.isEditorOpen,
    isInputPanelOpen: state.isInputPanelOpen,
    closeEditor: state.closeEditor,
    openEditor: state.openEditor,
    setFields: state.setFields,
    setInputPanelOpen: state.setInputPanelOpen,
    toggleInputPanel: state.toggleInputPanel,
  })))

  const handleSortChange = useCallback((newFields: SnippetInputField[]) => {
    setFields(newFields)
  }, [setFields])

  const handleRemoveField = useCallback((index: number) => {
    const nextFields = fields.filter((_, currentIndex) => currentIndex !== index)
    setFields(nextFields)
    void syncInputFieldsDraft(nextFields, {
      onRefresh: setFields,
    })
  }, [fields, setFields, syncInputFieldsDraft])

  const handleSubmitField = useCallback((field: SnippetInputField) => {
    const originalVariable = editingField?.variable
    const duplicated = fields.some(item => item.variable === field.variable && item.variable !== originalVariable)

    if (duplicated) {
      toast.error(t('inputFieldPanel.error.variableDuplicate', { ns: 'datasetPipeline' }))
      return
    }

    const nextFields = originalVariable
      ? fields.map(item => item.variable === originalVariable ? field : item)
      : [...fields, field]

    setFields(nextFields)
    void syncInputFieldsDraft(nextFields, {
      onRefresh: setFields,
    })
    closeEditor()
  }, [closeEditor, editingField?.variable, fields, setFields, syncInputFieldsDraft, t])

  const handleToggleInputPanel = useCallback(() => {
    if (isInputPanelOpen)
      closeEditor()
    toggleInputPanel()
  }, [closeEditor, isInputPanelOpen, toggleInputPanel])

  const handleCloseInputPanel = useCallback(() => {
    closeEditor()
    setInputPanelOpen(false)
  }, [closeEditor, setInputPanelOpen])

  return {
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    openEditor,
    closeEditor,
    handleCloseInputPanel,
    handleRemoveField,
    handleSortChange,
    handleSubmitField,
    handleToggleInputPanel,
  }
}
