'use client'
import type { FC } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import React, { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import Base from '../base'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import './style.css'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

// load file from local instead of cdn https://github.com/suren-atoyan/monaco-react/issues/482
loader.config({ paths: { vs: '/vs' } })

type Props = {
  nodeId: string
  value?: string | object
  onChange?: (value: string) => void
  title: JSX.Element
  language: CodeLanguage
  headerRight?: JSX.Element
  readOnly?: boolean
  isJSONStringifyBeauty?: boolean
  height?: number
  isInNode?: boolean
}

const languageMap = {
  [CodeLanguage.javascript]: 'javascript',
  [CodeLanguage.python3]: 'python',
  [CodeLanguage.json]: 'json',
}

const CodeEditor: FC<Props> = ({
  nodeId,
  value = '',
  onChange = () => { },
  title,
  headerRight,
  language,
  readOnly,
  isJSONStringifyBeauty,
  height,
  isInNode,
}) => {
  const [isFocus, setIsFocus] = React.useState(false)

  const { availableVars, availableNodes } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  const handleEditorChange = (value: string | undefined) => {
    onChange(value || '')
  }

  const editorRef = useRef(null)
  const popupRef = useRef(null)
  const [isEditorMounted, setEditorMounted] = React.useState(false)

  // Create a content widget for the popup
  const popupWidget = {
    getId: () => 'custom-popup',
    getDomNode: () => popupRef.current,
    getPosition: () => ({
      position: (editorRef.current as any)?.getPosition(),
      preference: [monaco.editor.ContentWidgetPositionPreference.BELOW, monaco.editor.ContentWidgetPositionPreference.EXACT],
    }),
    allowEditorOverflow: true,
  }

  const hidePopup = () => {
    const editor: any = editorRef.current
    editor?.removeContentWidget(popupWidget)
  }
  useEffect(() => {
    if (!isEditorMounted)
      return

    if (editorRef.current) {
      const editor: any = editorRef.current

      // Show the popup when the user types "/"
      const showPopup = () => {
        editor.addContentWidget(popupWidget)
      }

      // Hide the popup when the user types any other character or moves the cursor

      // Listen for cursor position changes
      editor.onDidChangeCursorPosition((event: any) => {
        const { position } = event
        const text = editor.getModel().getLineContent(position.lineNumber)
        const charBefore = text[position.column - 2]
        if (charBefore === '/')
          showPopup()
        else
          hidePopup()
      })

      // Hide the popup when the component unmounts
      return () => {
        hidePopup()
      }
    }
  }, [isEditorMounted])

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor
    setEditorMounted(true)
    editor.onDidFocusEditorText(() => {
      setIsFocus(true)
    })
    editor.onDidBlurEditorText(() => {
      setIsFocus(false)
    })

    monaco.editor.defineTheme('blur-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#F2F4F7',
      },
    })

    monaco.editor.defineTheme('focus-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
      },
    })
  }

  const outPutValue = (() => {
    if (!isJSONStringifyBeauty)
      return value as string
    try {
      return JSON.stringify(value as object, null, 2)
    }
    catch (e) {
      return value as string
    }
  })()

  return (
    <div>
      <Base
        title={title}
        value={outPutValue}
        headerRight={headerRight}
        isFocus={isFocus && !readOnly}
        minHeight={height || 200}
        isInNode={isInNode}
      >
        <>
          {/* https://www.npmjs.com/package/@monaco-editor/react */}
          <Editor
            className='h-full'
            // language={language === CodeLanguage.javascript ? 'javascript' : 'python'}
            language={languageMap[language] || 'javascript'}
            theme={isFocus ? 'focus-theme' : 'blur-theme'}
            value={outPutValue}
            onChange={handleEditorChange}
            // https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IEditorOptions.html
            options={{
              readOnly,
              domReadOnly: true,
              quickSuggestions: false,
              minimap: { enabled: false },
              lineNumbersMinChars: 1, // would change line num width
              wordWrap: 'on', // auto line wrap
              // lineNumbers: (num) => {
              //   return <div>{num}</div>
              // }
            }}
            onMount={handleEditorDidMount}
          />
        </>
      </Base>
      <div ref={popupRef} style={{ display: 'none', width: 200, background: '#fff' }}>
        <VarReferenceVars
          hideSearch
          vars={availableVars}
          onChange={(variables: string[]) => {
            // handleSelectWorkflowVariable(variables)
            console.log(variables)
            hidePopup()
          }}
        />
      </div>
    </div>
  )
}
export default React.memo(CodeEditor)
