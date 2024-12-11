'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import type { Props as EditorProps } from '.'
import Editor from '.'
import cn from '@/utils/classnames'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type { NodeOutPutVar, Variable } from '@/app/components/workflow/types'

const TO_WINDOW_OFFSET = 8

type Props = {
  availableVars: NodeOutPutVar[]
  varList: Variable[]
  onAddVar?: (payload: Variable) => void
} & EditorProps

const CodeEditor: FC<Props> = ({
  availableVars,
  varList,
  onAddVar,
  ...editorProps
}) => {
  const { t } = useTranslation()

  const isLeftBraceRef = useRef(false)

  const editorRef = useRef(null)
  const monacoRef = useRef(null)

  const popupRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    if (isShowVarPicker && popupRef.current) {
      const windowWidth = window.innerWidth
      const { width, height } = popupRef.current!.getBoundingClientRect()
      const newPopupPosition = { ...popupPosition }
      if (popupPosition.x + width > windowWidth - TO_WINDOW_OFFSET)
        newPopupPosition.x = windowWidth - width - TO_WINDOW_OFFSET

      if (popupPosition.y + height > window.innerHeight - TO_WINDOW_OFFSET)
        newPopupPosition.y = window.innerHeight - height - TO_WINDOW_OFFSET

      if (newPopupPosition.x !== popupPosition.x || newPopupPosition.y !== popupPosition.y)
        setPopupPosition(newPopupPosition)
    }
  }, [isShowVarPicker, popupPosition])

  const onEditorMounted = (editor: any, monaco: any) => {
    editorRef.current = editor
    monacoRef.current = monaco
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

      onAddVar?.(newVar)
    }
    const editor: any = editorRef.current
    const monaco: any = monacoRef.current
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
    <div className={cn(editorProps.isExpand && 'h-full')}>
      <Editor
        {...editorProps}
        onMount={onEditorMounted}
        placeholder={t('workflow.common.jinjaEditorPlaceholder')!}
      />
      {isShowVarPicker && (
        <div
          ref={popupRef}
          className='w-[228px] p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1'
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
            isSupportFileVar={false}
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(CodeEditor)
