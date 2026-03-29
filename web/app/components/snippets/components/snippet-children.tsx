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

      {isInputPanelOpen && (
        <div className="pointer-events-none absolute inset-y-3 right-3 z-30 flex justify-end">
          <div className="pointer-events-auto h-full xl:hidden">
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

      {isEditorOpen && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/10 px-3 xl:hidden">
          <div className="pointer-events-auto w-full max-w-md">
            <SnippetInputFieldEditor
              field={editingField}
              onClose={onCloseEditor}
              onSubmit={onSubmitField}
            />
          </div>
        </div>
      )}
    </>
  )
}

export default SnippetChildren
