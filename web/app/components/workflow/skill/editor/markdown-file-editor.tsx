import type { FC } from 'react'
import * as React from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'

type MarkdownFileEditorProps = {
  value: string
  onChange: (value: string) => void
}

const MarkdownFileEditor: FC<MarkdownFileEditorProps> = ({ value, onChange }) => {
  return (
    <div className="h-full w-full bg-components-panel-bg">
      <PromptEditor
        value={value}
        onChange={onChange}
        showLineNumbers
        className="h-full"
        wrapperClassName="h-full"
      />
    </div>
  )
}

export default React.memo(MarkdownFileEditor)
