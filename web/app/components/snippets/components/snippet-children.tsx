'use client'

import type { SnippetInputField } from '@/models/snippet'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  snippetId: string
  fields: SnippetInputField[]
  isPublishing: boolean
  onCancel: () => void
  onPublish: () => void
}

const SnippetChildren = ({
  snippetId,
  fields,
  isPublishing,
  onCancel,
  onPublish,
}: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-background-body to-transparent" />

      <SnippetHeader
        snippetId={snippetId}
        isPublishing={isPublishing}
        onCancel={onCancel}
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
