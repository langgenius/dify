'use client'

import type { InputVar } from '@/models/pipeline'
import SnippetHeader from './snippet-header'
import SnippetWorkflowPanel from './workflow-panel'

type SnippetChildrenProps = {
  fields: InputVar[]
  canSave: boolean
  canEdit: boolean
  isPublishing: boolean
  onPublish: () => void
}

const SnippetChildren = ({
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
        canSave={canSave}
        canEdit={canEdit}
        isPublishing={isPublishing}
        onPublish={onPublish}
      />

      <SnippetWorkflowPanel fields={fields} />
    </>
  )
}

export default SnippetChildren
