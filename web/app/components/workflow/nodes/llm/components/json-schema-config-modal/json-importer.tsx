import type { FC } from 'react'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { cn } from '@/utils/classnames'
import { checkJsonDepth } from '../../utils'
import CodeEditor from './code-editor'
import ErrorMessage from './error-message'
import { useMittContext } from './visual-editor/context'
import { useVisualEditorStore } from './visual-editor/store'

type JsonImporterProps = {
  onSubmit: (schema: any) => void
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
  const importBtnRef = useRef<HTMLElement>(null)
  const advancedEditing = useVisualEditorStore(state => state.advancedEditing)
  const isAddingNewField = useVisualEditorStore(state => state.isAddingNewField)
  const { emit } = useMittContext()

  useEffect(() => {
    if (importBtnRef.current) {
      const rect = importBtnRef.current.getBoundingClientRect()
      updateBtnWidth(rect.width)
    }
  }, [])

  const handleTrigger = useCallback((e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    e.stopPropagation()
    if (advancedEditing || isAddingNewField)
      emit('quitEditing', {})
    setOpen(!open)
  }, [open, advancedEditing, isAddingNewField, emit])

  const onClose = useCallback(() => {
    setOpen(false)
  }, [])

  const handleSubmit = useCallback(() => {
    try {
      const parsedJSON = JSON.parse(json)
      if (typeof parsedJSON !== 'object' || Array.isArray(parsedJSON)) {
        setParseError(new Error('Root must be an object, not an array or primitive value.'))
        return
      }
      const maxDepth = checkJsonDepth(parsedJSON)
      if (maxDepth > JSON_SCHEMA_MAX_DEPTH) {
        setParseError({
          type: 'error',
          message: `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
        })
        return
      }
      onSubmit(parsedJSON)
      setParseError(null)
      setOpen(false)
    }
    catch (e: any) {
      if (e instanceof Error)
        setParseError(e)
      else
        setParseError(new Error('Invalid JSON'))
    }
  }, [onSubmit, json])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      offset={{
        mainAxis: 4,
        crossAxis: 16,
      }}
    >
      <PortalToFollowElemTrigger ref={importBtnRef} onClick={handleTrigger}>
        <button
          type="button"
          className={cn(
            'system-xs-medium flex shrink-0 rounded-md px-1.5 py-1 text-text-tertiary hover:bg-components-button-ghost-bg-hover',
            open && 'bg-components-button-ghost-bg-hover',
          )}
        >
          <span className="px-0.5">{t('nodes.llm.jsonSchema.import', { ns: 'workflow' })}</span>
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[100]">
        <div className="flex w-[400px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9">
          {/* Title */}
          <div className="relative px-3 pb-1 pt-3.5">
            <div className="absolute bottom-0 right-2.5 flex h-8 w-8 items-center justify-center" onClick={onClose}>
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
            <div className="system-xl-semibold flex pl-1 pr-8 text-text-primary">
              {t('nodes.llm.jsonSchema.import', { ns: 'workflow' })}
            </div>
          </div>
          {/* Content */}
          <div className="px-4 py-2">
            <CodeEditor
              className="rounded-lg"
              editorWrapperClassName="h-[340px]"
              value={json}
              onUpdate={setJson}
              showFormatButton={false}
            />
            {parseError && <ErrorMessage message={parseError.message} />}
          </div>
          {/* Footer */}
          <div className="flex items-center justify-end gap-x-2 p-4 pt-2">
            <Button variant="secondary" onClick={onClose}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button variant="primary" onClick={handleSubmit}>
              {t('operation.submit', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default JsonImporter
