import type { FC } from 'react'
import * as React from 'react'
import PromptEditor from '@/app/components/workflow/nodes/_base/components/prompt/editor'

type MarkdownFileEditorProps = {
  title: string
  value: string
  onChange: (value: string) => void
}

const MarkdownFileEditor: FC<MarkdownFileEditorProps> = ({ title, value, onChange }) => {
  return (
    <div className="h-full w-full">
      <PromptEditor
        title={title}
        value={value}
        onChange={onChange}
        className="h-full"
        editorContainerClassName="h-full"
        containerBackgroundClassName="bg-components-panel-bg"
      />
    </div>
  )
}

export default React.memo(MarkdownFileEditor)
