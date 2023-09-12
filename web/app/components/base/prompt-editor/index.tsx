'use client'

import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary'
import ComponentPicker from './plugins/component-picker'
import VariablePicker from './plugins/variable-picker'

const PromptEditor = () => {
  const initialConfig = {
    namespace: 'prompt-editor',
    onError: (error: Error) => {
      throw error
    },
  }

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={<ContentEditable />}
        placeholder={<div>enter</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <ComponentPicker />
      <VariablePicker />
    </LexicalComposer>
  )
}

export default PromptEditor
