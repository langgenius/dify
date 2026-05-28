'use client'

import type { SnippetInputField } from '@/models/snippet'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  snippetId: string
  fields: SnippetInputField[]
  hasDraftChanges: boolean
  isEditing: boolean
  isPublishing: boolean
  onCancel: () => void
  onDiscardAndExitEditing: () => void | Promise<void>
  onEdit: () => void
  onExitEditing: () => void | Promise<void>
  onPublish: () => void
  onSaveAndExitEditing: () => void | Promise<void>
}

const SnippetChildren = ({
  snippetId,
  fields,
  hasDraftChanges,
  isEditing,
  isPublishing,
  onCancel,
  onDiscardAndExitEditing,
  onEdit,
  onExitEditing,
  onPublish,
  onSaveAndExitEditing,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-background-body to-transparent" />

      <SnippetHeader
        snippetId={snippetId}
        hasDraftChanges={hasDraftChanges}
        isEditing={isEditing}
        isPublishing={isPublishing}
        onCancel={onCancel}
        onDiscardAndExitEditing={onDiscardAndExitEditing}
        onEdit={onEdit}
        onExitEditing={onExitEditing}
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
