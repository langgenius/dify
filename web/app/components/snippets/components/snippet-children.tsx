'use client'

import type { SnippetDetailUIModel, SnippetInputField } from '@/models/snippet'
import SnippetInputFieldEditor from './input-field-editor'
import SnippetInputFieldPanel from './panel'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  snippetId: string
  fields: SnippetInputField[]
  uiMeta: SnippetDetailUIModel
  editingField: SnippetInputField | null
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  isPublishMenuOpen: boolean
  isPublishing: boolean
  onToggleInputPanel: () => void
  onPublishMenuOpenChange: (open: boolean) => void
  onCloseInputPanel: () => void
  onPublish: () => void
  onOpenEditor: (field?: SnippetInputField | null) => void
  onCloseEditor: () => void
  onSubmitField: (field: SnippetInputField) => void
  onRemoveField: (index: number) => void
  onSortChange: (fields: SnippetInputField[]) => void
}

const SnippetChildren = ({
  snippetId,
  fields,
  uiMeta,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  isPublishMenuOpen,
  isPublishing,
  onToggleInputPanel,
  onPublishMenuOpenChange,
  onCloseInputPanel,
  onPublish,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onSortChange,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-background-body to-transparent" />

      <SnippetHeader
        snippetId={snippetId}
        inputFieldCount={fields.length}
        uiMeta={uiMeta}
        isPublishMenuOpen={isPublishMenuOpen}
        isPublishing={isPublishing}
        onToggleInputPanel={onToggleInputPanel}
        onPublishMenuOpenChange={onPublishMenuOpenChange}
        onPublish={onPublish}
      />

      <SnippetWorkflowPanel
        snippetId={snippetId}
        fields={fields}
        editingField={editingField}
        isEditorOpen={isEditorOpen}
        isInputPanelOpen={isInputPanelOpen}
        onCloseInputPanel={onCloseInputPanel}
        onOpenEditor={onOpenEditor}
        onCloseEditor={onCloseEditor}
        onSubmitField={onSubmitField}
        onRemoveField={onRemoveField}
        onSortChange={onSortChange}
      />

      {(isInputPanelOpen || isEditorOpen) && (
        <div className="pointer-events-none absolute bottom-1 right-1 top-14 z-30 flex justify-end">
          <div className="pointer-events-auto flex h-full xl:hidden">
            {isEditorOpen && (
              <SnippetInputFieldEditor
                field={editingField}
                onClose={onCloseEditor}
                onSubmit={onSubmitField}
              />
            )}
            <SnippetInputFieldPanel
              fields={fields}
              onClose={onCloseInputPanel}
              onAdd={() => onOpenEditor()}
              onEdit={onOpenEditor}
              onRemove={onRemoveField}
              onSortChange={onSortChange}
            />
          </div>
        </div>
      )}

    </>
  )
}

export default SnippetChildren
