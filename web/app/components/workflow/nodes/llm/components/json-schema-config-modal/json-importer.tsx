import React, { type FC, useCallback, useEffect, useRef, useState } from 'react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'
import { useTranslation } from 'react-i18next'
import { RiClipboardLine, RiCloseLine, RiErrorWarningFill, RiIndentIncrease } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import { Editor } from '@monaco-editor/react'
import Button from '@/app/components/base/button'

type JsonImporterProps = {
  onSubmit: (schema: string) => void
  updateBtnWidth: (width: number) => void
}

const JsonImporter: FC<JsonImporterProps> = ({
  onSubmit,
  updateBtnWidth,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [json, setJson] = useState('')
  const [parseError, setParseError] = useState<any>(null)
  const importBtnRef = useRef<HTMLButtonElement>(null)
  const monacoRef = useRef<any>(null)
  const editorRef = useRef<any>(null)

  useEffect(() => {
    if (importBtnRef.current) {
      const rect = importBtnRef.current.getBoundingClientRect()
      updateBtnWidth(rect.width)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setJson(value)
  }, [])

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    setOpen(!open)
  }, [open])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const formatJsonContent = useCallback(() => {
    if (editorRef.current)
      editorRef.current.getAction('editor.action.formatDocument')?.run()
  }, [])

  const handleSubmit = useCallback(() => {
    try {
      const parsedJSON = JSON.parse(json)
      onSubmit(parsedJSON)
      setParseError(null)
    }
    catch (e: any) {
      if (e instanceof SyntaxError)
        setParseError(e)
      else
        setParseError(new Error('Unknown error'))
    }
  }, [onSubmit, json])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 16,
      }}
    >
      <PortalToFollowElemTrigger ref={importBtnRef} onClick={handleTrigger}>
        <button
          type='button'
          className={cn(
            'flex shrink-0 px-1.5 py-1 rounded-md hover:bg-components-button-ghost-bg-hover text-text-tertiary system-xs-medium',
            open && 'bg-components-button-ghost-bg-hover',
          )}
        >
          <span className='px-0.5'>{t('workflow.nodes.llm.jsonSchema.import')}</span>
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[100]'>
        <div className='flex flex-col w-[400px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9'>
          {/* Title */}
          <div className='relative px-3 pt-3.5 pb-1'>
            <div className='flex items-center justify-center absolute right-2.5 bottom-0 w-8 h-8' onClick={onClose}>
              <RiCloseLine className='w-4 h-4 text-text-tertiary' />
            </div>
            <div className='flex pl-1 pr-8 text-text-primary system-xl-semibold'>
              {t('workflow.nodes.llm.jsonSchema.import')}
            </div>
          </div>
          {/* Content */}
          <div className='px-4 py-2'>
            <div className='flex flex-col h-full rounded-lg bg-components-input-bg-normal overflow-hidden'>
              <div className='flex items-center justify-between pl-2 pt-1 pr-1'>
                <div className='py-0.5 text-text-secondary system-xs-semibold-uppercase'>
                  <span className='px-1 py-0.5'>JSON</span>
                </div>
                <div className='flex items-center gap-x-0.5'>
                  <button
                    type='button'
                    className='flex items-center justify-center h-6 w-6'
                    onClick={formatJsonContent}
                  >
                    <RiIndentIncrease className='w-4 h-4 text-text-tertiary' />
                  </button>
                  <button
                    type='button'
                    className='flex items-center justify-center h-6 w-6'
                    onClick={() => copy(json)}>
                    <RiClipboardLine className='w-4 h-4 text-text-tertiary' />
                  </button>
                </div>
              </div>
              <div className='relative h-[340px]'>
                <Editor
                  height='100%'
                  defaultLanguage='json'
                  value={json}
                  onChange={handleEditorChange}
                  onMount={handleEditorDidMount}
                  options={{
                    readOnly: false,
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
            {parseError && (
              <div className='flex gap-x-1 mt-1 p-2 rounded-lg border-[0.5px] border-components-panel-border bg-toast-error-bg'>
                <RiErrorWarningFill className='shrink-0 w-4 h-4 text-text-destructive' />
                <div className='grow text-text-primary system-xs-medium'>
                  {parseError.message}
                </div>
              </div>
            )}
          </div>
          {/* Footer */}
          <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
            <Button variant='secondary' onClick={onClose}>
              {t('common.operation.cancel')}
            </Button>
            <Button variant='primary' onClick={handleSubmit}>
              {t('common.operation.submit')}
            </Button>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default JsonImporter
