'use client'
import type { FC } from 'react'
import React, { useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { useBoolean } from 'ahooks'
import type { Props as EditorProps } from '.'
import Editor from '.'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import type { Variable } from '@/app/components/workflow/types'

type Props = {
  nodeId: string
  varList: Variable[]
  onAddVar: (payload: Variable) => void
} & EditorProps

const CodeEditor: FC<Props> = ({
  nodeId,
  varList,
  onAddVar,
  ...editorProps
}) => {
  const { availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  const isLeftBraceRef = useRef(false)

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
    if (['/', '{'].includes(charBefore)) {
      isLeftBraceRef.current = charBefore === '{'
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

  const getUniqVarName = (varName: string) => {
    if (varList.find(v => v.variable === varName)) {
      const match = varName.match(/_([0-9]+)$/)

      const index = (() => {
        if (match)
          return parseInt(match[1]!) + 1

        return 1
      })()
      return getUniqVarName(`${varName.replace(/_([0-9]+)$/, '')}_${index}`)
    }
    return varName
  }

  const getVarName = (varValue: string[]) => {
    const existVar = varList.find(v => Array.isArray(v.value_selector) && v.value_selector.join('@@@') === varValue.join('@@@'))
    if (existVar) {
      return {
        name: existVar.variable,
        isExist: true,
      }
    }
    const varName = varValue.slice(-1)[0]
    return {
      name: getUniqVarName(varName),
      isExist: false,
    }
  }

  const handleSelectVar = (varValue: string[]) => {
    const { name, isExist } = getVarName(varValue)
    if (!isExist) {
      const newVar: Variable = {
        variable: name,
        value_selector: varValue,
      }

      onAddVar(newVar)
    }
    const editor: any = editorRef.current
    const position = editor?.getPosition()

    // Insert the content at the cursor position
    editor?.executeEdits('', [
      {
        // position.column - 1 to remove the text before the cursor
        range: new monaco.Range(position.lineNumber, position.column - 1, position.lineNumber, position.column),
        text: `{{ ${name} }${!isLeftBraceRef.current ? '}' : ''}`, // left brace would auto add one right brace
      },
    ])

    hideVarPicker()
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
            onChange={handleSelectVar}
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(CodeEditor)
