'use client'

import type { EditorState } from 'lexical'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import {
  $getRoot,
  TextNode,
} from 'lexical'
import * as React from 'react'
import { CustomTextNode } from '@/app/components/base/prompt-editor/plugins/custom-text/node'
import OnBlurBlock from '@/app/components/base/prompt-editor/plugins/on-blur-or-focus-block'
import Placeholder from '@/app/components/base/prompt-editor/plugins/placeholder'
import UpdateBlock from '@/app/components/base/prompt-editor/plugins/update-block'
import { textToEditorState } from '@/app/components/base/prompt-editor/utils'
import { cn } from '@/utils/classnames'
import styles from './line-numbers.module.css'
import FilePickerBlock from './plugins/file-picker-block'
import { FileReferenceNode } from './plugins/file-reference-block/node'
import { FilePreviewContextProvider } from './plugins/file-reference-block/preview-context'
import FileReferenceReplacementBlock from './plugins/file-reference-block/replacement-block'
import { LocalCursorPlugin, SkillRemoteCursors } from './plugins/remote-cursors'
import {
  ToolBlock,
  ToolBlockNode,
  ToolBlockReplacementBlock,
  ToolGroupBlockNode,
  ToolGroupBlockReplacementBlock,
} from './plugins/tool-block'
import ToolPickerBlock from './plugins/tool-block/tool-picker-block'

export type SkillEditorProps = {
  instanceId?: string
  compact?: boolean
  wrapperClassName?: string
  className?: string
  placeholder?: string | React.ReactNode
  placeholderClassName?: string
  showLineNumbers?: boolean
  style?: React.CSSProperties
  value?: string
  editable?: boolean
  autoFocus?: boolean
  collaborationEnabled?: boolean
  onChange?: (text: string) => void
  onBlur?: () => void
  onFocus?: () => void
  onAutoFocus?: () => void
  toolPickerScope?: string
}

type EditorAutoFocusPluginProps = {
  onAutoFocus?: () => void
}

const EditorAutoFocusPlugin = ({ onAutoFocus }: EditorAutoFocusPluginProps) => {
  const [editor] = useLexicalComposerContext()

  React.useEffect(() => {
    editor.focus(() => {
      const activeElement = document.activeElement
      const rootElement = editor.getRootElement()
      if (rootElement !== null && (activeElement === null || !rootElement.contains(activeElement)))
        rootElement.focus({ preventScroll: true })
      onAutoFocus?.()
    })
  }, [editor, onAutoFocus])

  return null
}

const SkillEditor = ({
  instanceId,
  compact,
  wrapperClassName,
  className,
  placeholder,
  placeholderClassName,
  showLineNumbers,
  style,
  value,
  editable = true,
  autoFocus = false,
  collaborationEnabled,
  onChange,
  onBlur,
  onFocus,
  onAutoFocus,
  toolPickerScope = 'all',
}: SkillEditorProps) => {
  const filePreviewContextValue = React.useMemo(() => ({ enabled: false }), [])

  const initialConfig = {
    namespace: 'skill-editor',
    nodes: [
      CodeNode,
      CustomTextNode,
      {
        replace: TextNode,
        with: (node: TextNode) => new CustomTextNode(node.__text),
      },
      ToolGroupBlockNode,
      ToolBlockNode,
      FileReferenceNode,
    ],
    editorState: textToEditorState(value || ''),
    onError: (error: Error) => {
      throw error
    },
  }

  const handleEditorChange = (editorState: EditorState) => {
    const text = editorState.read(() => {
      return $getRoot().getChildren().map(p => p.getTextContent()).join('\n')
    })
    if (onChange)
      onChange(text)
  }

  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editable }}>
      <FilePreviewContextProvider value={filePreviewContextValue}>
        <div
          className={cn('relative', showLineNumbers && styles.lineNumbersScope, wrapperClassName)}
          data-skill-editor-root="true"
        >
          <RichTextPlugin
            contentEditable={(
              <ContentEditable
                className={cn(
                  'text-text-secondary outline-none',
                  compact ? 'text-[13px] leading-5' : 'text-sm leading-6',
                  showLineNumbers && styles.lineNumbers,
                  className,
                )}
                style={style || {}}
              />
            )}
            placeholder={(
              <Placeholder
                value={placeholder}
                className={cn(
                  'truncate',
                  showLineNumbers && styles.lineNumbersPlaceholder,
                  placeholderClassName,
                )}
                compact={compact}
              />
            )}
            ErrorBoundary={LexicalErrorBoundary}
          />
          <>
            <ToolBlock />
            <ToolGroupBlockReplacementBlock />
            <ToolBlockReplacementBlock />
            <FileReferenceReplacementBlock />
            {editable && <FilePickerBlock />}
            {editable && <ToolPickerBlock scope={toolPickerScope} enableAutoDefault />}
          </>
          <OnChangePlugin onChange={handleEditorChange} />
          {editable && autoFocus && <EditorAutoFocusPlugin onAutoFocus={onAutoFocus} />}
          <OnBlurBlock onBlur={onBlur} onFocus={onFocus} />
          <UpdateBlock instanceId={instanceId} />
          <LocalCursorPlugin fileId={instanceId} enabled={collaborationEnabled} />
          <SkillRemoteCursors fileId={instanceId} enabled={collaborationEnabled} />
          <HistoryPlugin />
        </div>
      </FilePreviewContextProvider>
    </LexicalComposer>
  )
}

export default SkillEditor
