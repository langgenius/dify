'use client'

import SnippetHeader from './snippet-header'

type SnippetChildrenProps = {
  canSave: boolean
  canEdit: boolean
  isPublishing: boolean
  onPublish: () => void
}

const SnippetChildren = ({ canSave, canEdit, isPublishing, onPublish }: SnippetChildrenProps) => {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-background-body to-transparent" />

      <SnippetHeader
        canSave={canSave}
        canEdit={canEdit}
        isPublishing={isPublishing}
        onPublish={onPublish}
      />
    </>
  )
}

export default SnippetChildren
