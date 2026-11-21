import type { InitialConfigType } from '@lexical/react/LexicalComposer'
import type { ReactNode } from 'react'
import { LexicalExtensionComposer } from '@lexical/react/LexicalExtensionComposer'
import { defineExtension } from 'lexical'
import { useState } from 'react'

// Fixtures keep one editor for their mounted lifetime, even when rerendered with new props.
export const TestLexicalComposer = ({
  initialConfig,
  children,
}: {
  initialConfig: InitialConfigType
  children?: ReactNode
}) => {
  const [extension] = useState(() => {
    const { editorState, ...config } = initialConfig
    return defineExtension({
      ...config,
      name: config.namespace,
      $initialEditorState: editorState,
    })
  })
  return (
    <LexicalExtensionComposer extension={extension} contentEditable={null}>
      {children}
    </LexicalExtensionComposer>
  )
}
