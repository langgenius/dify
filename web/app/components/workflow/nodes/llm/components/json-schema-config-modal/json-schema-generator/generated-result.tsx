import React, { type FC, useCallback, useRef, useState } from 'react'
import type { SchemaRoot } from '../../../types'
import { RiArrowLeftLine, RiClipboardLine, RiCloseLine, RiSparklingLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Editor from '@monaco-editor/react'
import copy from 'copy-to-clipboard'
import Button from '@/app/components/base/button'

type GeneratedResultProps = {
  schema: SchemaRoot
  onBack: () => void
  onRegenerate: () => void
  onClose: () => void
  onApply: (schema: any) => void
}

const GeneratedResult: FC<GeneratedResultProps> = ({
  schema,
  onBack,
  onRegenerate,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation()
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)

  const formatJSON = (json: any): string => {
    try {
      if (typeof json === 'string') {
        const parsed = JSON.parse(json)
        return JSON.stringify(parsed, null, 2)
      }
      return JSON.stringify(json, null, 2)
    }
    catch (e) {
      console.error('Failed to format JSON:', e)
      return typeof json === 'string' ? json : JSON.stringify(json)
    }
  }

  const [jsonSchema, setJsonSchema] = useState(formatJSON(schema))

  const handleEditorDidMount = useCallback((editor: any, monaco: any) => {
    editorRef.current = editor
    monacoRef.current = monaco
    monaco.editor.defineTheme('light-theme', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#00000000',
        'editor.lineHighlightBackground': '#00000000',
        'focusBorder': '#00000000',
      },
    })
    monaco.editor.setTheme('light-theme')
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (!value)
      return
    setJsonSchema(value)
  }, [])

  const handleApply = useCallback(() => {
    try {
      // Parse the JSON to ensure it's valid before applying
      const parsedJSON = JSON.parse(jsonSchema)
      onApply(parsedJSON)
    }
    catch {
      // TODO: Handle invalid JSON error
    }
  }, [jsonSchema, onApply])

  return (
    <div className='flex flex-col w-[480px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'>
      <div className='flex items-center justify-center absolute top-2.5 right-2.5 w-8 h-8' onClick={onClose}>
        <RiCloseLine className='w-4 h-4 text-text-tertiary' />
      </div>
      {/* Title */}
      <div className='flex flex-col gap-y-[0.5px] px-3 pt-3.5 pb-1'>
        <div className='flex pl-1 pr-8 text-text-primary system-xl-semibold'>
          {t('workflow.nodes.llm.jsonSchema.generatedResult')}
        </div>
        <div className='flex px-1 text-text-tertiary system-xs-regular'>
          {t('workflow.nodes.llm.jsonSchema.resultTip')}
        </div>
      </div>
      {/* Content */}
      <div className='w-full h-[468px] px-4 py-2'>
        <div className='flex flex-col h-full rounded-lg bg-components-input-bg-normal overflow-hidden'>
          <div className='flex items-center justify-between pl-2 pt-1 pr-1'>
            <div className='py-0.5 text-text-secondary system-xs-semibold-uppercase'>
              <span className='px-1 py-0.5'>JSON</span>
            </div>
            <button
              type='button'
              className='flex items-center justify-center h-6 w-6'
              onClick={() => copy(jsonSchema)}>
              <RiClipboardLine className='w-4 h-4 text-text-tertiary' />
            </button>
          </div>
          <div className='relative grow'>
            <Editor
              height='100%'
              defaultLanguage='json'
              value={jsonSchema}
              onChange={handleEditorChange}
              onMount={handleEditorDidMount}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                tabSize: 2,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                wrappingIndent: 'same',
                // Add these options
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                renderLineHighlightOnlyWhenFocus: false,
                renderLineHighlight: 'none',
                // Hide scrollbar borders
                scrollbar: {
                  vertical: 'hidden',
                  horizontal: 'hidden',
                  verticalScrollbarSize: 0,
                  horizontalScrollbarSize: 0,
                  alwaysConsumeMouseWheel: false,
                },
              }}

            />
          </div>
        </div>
      </div>
      {/* Footer */}
      <div className='flex items-center justify-between p-4 pt-2'>
        <Button variant='secondary' className='flex items-center gap-x-0.5' onClick={onBack}>
          <RiArrowLeftLine className='w-4 h-4' />
          <span>{t('workflow.nodes.llm.jsonSchema.back')}</span>
        </Button>
        <div className='flex items-center gap-x-2'>
          <Button variant='secondary' className='flex items-center gap-x-0.5' onClick={onRegenerate}>
            <RiSparklingLine className='w-4 h-4' />
            <span>{t('workflow.nodes.llm.jsonSchema.regenerate')}</span>
          </Button>
          <Button variant='primary' onClick={handleApply}>
            {t('workflow.nodes.llm.jsonSchema.apply')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default GeneratedResult
