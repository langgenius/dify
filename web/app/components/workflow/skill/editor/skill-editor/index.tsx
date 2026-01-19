'use client'

import type { EditorState } from 'lexical'
import type { FC } from 'react'
import { CodeNode } from '@lexical/code'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
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
import FileReferenceReplacementBlock from './plugins/file-reference-block/replacement-block'
import {
  ToolBlock,
  ToolBlockNode,
  ToolBlockReplacementBlock,
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
  onChange?: (text: string) => void
  onBlur?: () => void
  onFocus?: () => void
  toolPickerScope?: string
}

const SkillEditor: FC<SkillEditorProps> = ({
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
  onChange,
  onBlur,
  onFocus,
  toolPickerScope = 'all',
}) => {
  const initialConfig = {
    namespace: 'skill-editor',
    nodes: [
      CodeNode,
      CustomTextNode,
      {
        replace: TextNode,
        with: (node: TextNode) => new CustomTextNode(node.__text),
      },
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
          <ToolBlockReplacementBlock />
          <FileReferenceReplacementBlock />
          {editable && <FilePickerBlock />}
          {editable && <ToolPickerBlock scope={toolPickerScope} />}
        </>
        <OnChangePlugin onChange={handleEditorChange} />
        <OnBlurBlock onBlur={onBlur} onFocus={onFocus} />
        <UpdateBlock instanceId={instanceId} />
        <HistoryPlugin />
      </div>
    </LexicalComposer>
  )
}

export default SkillEditor
