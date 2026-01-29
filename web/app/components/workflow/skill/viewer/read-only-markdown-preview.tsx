'use client'

import * as React from 'react'
import MarkdownFileEditor from '../editor/markdown-file-editor'

type ReadOnlyMarkdownPreviewProps = {
  value: string
}

const noop = () => {}

const ReadOnlyMarkdownPreview = ({ value }: ReadOnlyMarkdownPreviewProps) => {
  return (
    <MarkdownFileEditor
      value={value}
      onChange={noop}
      readOnly
    />
  )
}

export default React.memo(ReadOnlyMarkdownPreview)
