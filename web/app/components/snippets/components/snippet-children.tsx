'use client'

import type { SnippetInputField } from '@/models/snippet'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  snippetId: string
  fields: SnippetInputField[]
  canDiscardChanges: boolean
  canSave: boolean
  hasDraftChanges: boolean
  isEditing: boolean
  isPublishing: boolean
  onCancel: () => void
  onEdit: () => void
  onExitEditing: () => void | Promise<void>
  onExitEditingWithoutSave: () => void | Promise<void>
  onPublish: () => void
  onSaveAndExitEditing: () => void | Promise<void>
}

const SnippetChildren = ({
  snippetId,
  fields,
  canDiscardChanges,
  canSave,
  hasDraftChanges,
  isEditing,
  isPublishing,
  onCancel,
  onEdit,
  onExitEditing,
  onExitEditingWithoutSave,
  onPublish,
  onSaveAndExitEditing,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-background-body to-transparent" />

      <SnippetHeader
        snippetId={snippetId}
        canDiscardChanges={canDiscardChanges}
        canSave={canSave}
        hasDraftChanges={hasDraftChanges}
        isEditing={isEditing}
        isPublishing={isPublishing}
        onCancel={onCancel}
        onEdit={onEdit}
        onExitEditing={onExitEditing}
        onExitEditingWithoutSave={onExitEditingWithoutSave}
        onPublish={onPublish}
        onSaveAndExitEditing={onSaveAndExitEditing}
      />

      <SnippetWorkflowPanel
        snippetId={snippetId}
        fields={fields}
      />
    </>
  )
}

export default SnippetChildren
