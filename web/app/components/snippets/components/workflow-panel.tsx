'use client'

import type { PanelProps } from '@/app/components/workflow/panel'
import type { SnippetInputField } from '@/models/snippet'
import { memo, useMemo } from 'react'
import Panel from '@/app/components/workflow/panel'
import SnippetInputFieldEditor from './input-field-editor'
import SnippetInputFieldPanel from './panel'

type SnippetWorkflowPanelProps = {
  fields: SnippetInputField[]
  editingField: SnippetInputField | null
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  onCloseInputPanel: () => void
  onOpenEditor: (field?: SnippetInputField | null) => void
  onCloseEditor: () => void
  onSubmitField: (field: SnippetInputField) => void
  onRemoveField: (index: number) => void
  onPrimarySortChange: (fields: SnippetInputField[]) => void
  onSecondarySortChange: (fields: SnippetInputField[]) => void
}

const SnippetPanelOnLeft = ({
  fields,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onPrimarySortChange,
  onSecondarySortChange,
}: SnippetWorkflowPanelProps) => {
  return (
    <div className="hidden xl:flex">
      {isEditorOpen && (
        <SnippetInputFieldEditor
          field={editingField}
          onClose={onCloseEditor}
          onSubmit={onSubmitField}
        />
      )}
      {isInputPanelOpen && (
        <SnippetInputFieldPanel
          fields={fields}
          onClose={onCloseInputPanel}
          onAdd={() => onOpenEditor()}
          onEdit={onOpenEditor}
          onRemove={onRemoveField}
          onPrimarySortChange={onPrimarySortChange}
          onSecondarySortChange={onSecondarySortChange}
        />
      )}
    </div>
  )
}

const SnippetWorkflowPanel = ({
  fields,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onPrimarySortChange,
  onSecondarySortChange,
}: SnippetWorkflowPanelProps) => {
  const panelProps: PanelProps = useMemo(() => {
    return {
      components: {
        left: (
          <SnippetPanelOnLeft
            fields={fields}
            editingField={editingField}
            isEditorOpen={isEditorOpen}
            isInputPanelOpen={isInputPanelOpen}
            onCloseInputPanel={onCloseInputPanel}
            onOpenEditor={onOpenEditor}
            onCloseEditor={onCloseEditor}
            onSubmitField={onSubmitField}
            onRemoveField={onRemoveField}
            onPrimarySortChange={onPrimarySortChange}
            onSecondarySortChange={onSecondarySortChange}
          />
        ),
      },
    }
  }, [
    editingField,
    fields,
    isEditorOpen,
    isInputPanelOpen,
    onCloseEditor,
    onCloseInputPanel,
    onOpenEditor,
    onPrimarySortChange,
    onRemoveField,
    onSecondarySortChange,
    onSubmitField,
  ])

  return <Panel {...panelProps} />
}

export default memo(SnippetWorkflowPanel)
