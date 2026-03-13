'use client'

import type { SnippetDetailUIModel, SnippetInputField } from '@/models/snippet'
import SnippetInputFieldEditor from './input-field-editor'
import SnippetInputFieldPanel from './panel'
import PublishMenu from './publish-menu'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  fields: SnippetInputField[]
  uiMeta: SnippetDetailUIModel
  editingField: SnippetInputField | null
  isEditorOpen: boolean
  isInputPanelOpen: boolean
  isPublishMenuOpen: boolean
  onToggleInputPanel: () => void
  onTogglePublishMenu: () => void
  onCloseInputPanel: () => void
  onOpenEditor: (field?: SnippetInputField | null) => void
  onCloseEditor: () => void
  onSubmitField: (field: SnippetInputField) => void
  onRemoveField: (index: number) => void
  onPrimarySortChange: (fields: SnippetInputField[]) => void
  onSecondarySortChange: (fields: SnippetInputField[]) => void
}

const SnippetChildren = ({
  fields,
  uiMeta,
  editingField,
  isEditorOpen,
  isInputPanelOpen,
  isPublishMenuOpen,
  onToggleInputPanel,
  onTogglePublishMenu,
  onCloseInputPanel,
  onOpenEditor,
  onCloseEditor,
  onSubmitField,
  onRemoveField,
  onPrimarySortChange,
  onSecondarySortChange,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-background-body to-transparent" />

      <SnippetHeader
        inputFieldCount={fields.length}
        onToggleInputPanel={onToggleInputPanel}
        onTogglePublishMenu={onTogglePublishMenu}
      />

      <SnippetWorkflowPanel
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

      {isPublishMenuOpen && (
        <div className="absolute right-3 top-14 z-20">
          <PublishMenu uiMeta={uiMeta} />
        </div>
      )}

      {isInputPanelOpen && (
        <div className="pointer-events-none absolute inset-y-3 right-3 z-30 flex justify-end">
          <div className="pointer-events-auto h-full xl:hidden">
            <SnippetInputFieldPanel
              fields={fields}
              onClose={onCloseInputPanel}
              onAdd={() => onOpenEditor()}
              onEdit={onOpenEditor}
              onRemove={onRemoveField}
              onPrimarySortChange={onPrimarySortChange}
              onSecondarySortChange={onSecondarySortChange}
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
