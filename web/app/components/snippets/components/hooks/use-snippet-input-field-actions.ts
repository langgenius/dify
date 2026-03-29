import type { SnippetInputField } from '@/models/snippet'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/app/components/base/ui/toast'
import { useNodesSyncDraft } from '../../hooks/use-nodes-sync-draft'
import { useSnippetDetailStore } from '../../store'

type UseSnippetInputFieldActionsOptions = {
  snippetId: string
  initialFields: SnippetInputField[]
}

export const useSnippetInputFieldActions = ({
  snippetId,
  initialFields,
}: UseSnippetInputFieldActionsOptions) => {
  const { t } = useTranslation('snippet')
  const [fields, setFields] = useState<SnippetInputField[]>(initialFields)
  const { syncInputFieldsDraft } = useNodesSyncDraft(snippetId)
  const {
    editingField,
    isEditorOpen,
    isInputPanelOpen,
    closeEditor,
    openEditor,
    setInputPanelOpen,
    toggleInputPanel,
  } = useSnippetDetailStore(useShallow(state => ({
    editingField: state.editingField,
    isEditorOpen: state.isEditorOpen,
    isInputPanelOpen: state.isInputPanelOpen,
    closeEditor: state.closeEditor,
    openEditor: state.openEditor,
    setInputPanelOpen: state.setInputPanelOpen,
    toggleInputPanel: state.toggleInputPanel,
  })))

  const handleSortChange = useCallback((newFields: SnippetInputField[]) => {
    setFields(newFields)
  }, [])

  const handleRemoveField = useCallback((index: number) => {
    const nextFields = fields.filter((_, currentIndex) => currentIndex !== index)
    setFields(nextFields)
    void syncInputFieldsDraft(nextFields, {
      onRefresh: setFields,
    })
  }, [fields, syncInputFieldsDraft])

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
  }, [closeEditor, editingField?.variable, fields, syncInputFieldsDraft, t])

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
