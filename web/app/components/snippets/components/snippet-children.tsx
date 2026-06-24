'use client'

import type { SnippetInputField } from '@/models/snippet'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  snippetId: string
  fields: SnippetInputField[]
  canSave: boolean
  canEdit: boolean
  isPublishing: boolean
  onPublish: () => void
}

const SnippetChildren = ({
  snippetId,
  fields,
  canSave,
  canEdit,
  isPublishing,
  onPublish,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-background-body to-transparent" />

      <SnippetHeader
        snippetId={snippetId}
        canSave={canSave}
        canEdit={canEdit}
        isPublishing={isPublishing}
        onPublish={onPublish}
      />

      <SnippetWorkflowPanel
        snippetId={snippetId}
        fields={fields}
      />
    </>
  )
}

export default SnippetChildren
