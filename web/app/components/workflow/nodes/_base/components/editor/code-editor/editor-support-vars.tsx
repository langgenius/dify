'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useBoolean } from 'ahooks'
import type { Props as EditorProps } from '.'
import Editor from '.'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

type Props = {
  nodeId: string
} & EditorProps

const CodeEditor: FC<Props> = ({
  nodeId,
  ...editorProps
}) => {
  const { availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  const editorRef = useRef(null)
  const popupRef = useRef(null)
  const [isShowVarPicker, {
    setTrue: showVarPicker,
    setFalse: hideVarPicker,
  }] = useBoolean(false)

  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 })

  // Listen for cursor position changes
  const handleCursorPositionChange = (event: any) => {
    const editor: any = editorRef.current
    const { position } = event
    const text = editor.getModel().getLineContent(position.lineNumber)
    const charBefore = text[position.column - 2]
    if (charBefore === '/') {
      const editorRect = editor.getDomNode().getBoundingClientRect()
      const cursorCoords = editor.getScrolledVisiblePosition(position)
      const popupX = editorRect.left + cursorCoords.left
      const popupY = editorRect.top + cursorCoords.top + 20 // Adjust the vertical position as needed

      setPopupPosition({ x: popupX, y: popupY })
      showVarPicker()
    }
    else {
      hideVarPicker()
    }
  }

  const onEditorMounted = (editor: any) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition(handleCursorPositionChange)
  }

  return (
    <div>
      <Editor
        {...editorProps}
        onMount={onEditorMounted}
      />
      {isShowVarPicker && (
        <div
          ref={popupRef}
          className='bg-white border border-gray-200 w-[300px]'
          style={{
            position: 'fixed',
            top: popupPosition.y,
            left: popupPosition.x,
            zIndex: 100,
          }}
        >
          <VarReferenceVars
            hideSearch
            vars={availableVars}
            onChange={(variables: string[]) => {
              // handleSelectWorkflowVariable(variables)
              console.log(variables)
              const editor: any = editorRef.current
              const position = editor?.getPosition()

              // Insert the content at the cursor position
              editor?.executeEdits('', [
                {
                  // position.column - 1 to remove the text before the cursor
                  range: new monaco.Range(position.lineNumber, position.column - 1, position.lineNumber, position.column),
                  text: `{{ ${variables.slice(-1)[0]} }}`,
                },
              ])
              hideVarPicker()
            }}
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(CodeEditor)
