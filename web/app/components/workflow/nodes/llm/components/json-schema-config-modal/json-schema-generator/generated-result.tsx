import type { FC } from 'react'
import type { SchemaRoot } from '../../../types'
import { RiArrowLeftLine, RiCloseLine, RiSparklingLine } from '@remixicon/react'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Loading from '@/app/components/base/loading'
import { getValidationErrorMessage, validateSchemaAgainstDraft7 } from '../../../utils'
import CodeEditor from '../code-editor'
import ErrorMessage from '../error-message'

type GeneratedResultProps = {
  schema: SchemaRoot
  isGenerating: boolean
  onBack: () => void
  onRegenerate: () => void
  onClose: () => void
  onApply: () => void
}

const GeneratedResult: FC<GeneratedResultProps> = ({
  schema,
  isGenerating,
  onBack,
  onRegenerate,
  onClose,
  onApply,
}) => {
  const { t } = useTranslation()
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')

  const formatJSON = (json: SchemaRoot) => {
    try {
      const schema = JSON.stringify(json, null, 2)
      setParseError(null)
      return schema
    }
    catch (e) {
      if (e instanceof Error)
        setParseError(e)
      else
        setParseError(new Error('Invalid JSON'))
      return ''
    }
  }

  const jsonSchema = useMemo(() => formatJSON(schema), [schema])

  const handleApply = useCallback(() => {
    const validationErrors = validateSchemaAgainstDraft7(schema)
    if (validationErrors.length > 0) {
      setValidationError(getValidationErrorMessage(validationErrors))
      return
    }
    onApply()
    setValidationError('')
  }, [schema, onApply])

  return (
    <div className="flex w-[480px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl shadow-shadow-shadow-9">
      {
        isGenerating ? (
          <div className="flex h-[600px] flex-col items-center justify-center gap-y-3">
            <Loading type="area" />
            <div className="system-xs-regular text-text-tertiary">{t('nodes.llm.jsonSchema.generating', { ns: 'workflow' })}</div>
          </div>
        ) : (
          <>
            <div className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center" onClick={onClose}>
              <RiCloseLine className="h-4 w-4 text-text-tertiary" />
            </div>
            {/* Title */}
            <div className="flex flex-col gap-y-[0.5px] px-3 pb-1 pt-3.5">
              <div className="system-xl-semibold flex pl-1 pr-8 text-text-primary">
                {t('nodes.llm.jsonSchema.generatedResult', { ns: 'workflow' })}
              </div>
              <div className="system-xs-regular flex px-1 text-text-tertiary">
                {t('nodes.llm.jsonSchema.resultTip', { ns: 'workflow' })}
              </div>
            </div>
            {/* Content */}
            <div className="px-4 py-2">
              <CodeEditor
                className="rounded-lg"
                editorWrapperClassName="h-[424px]"
                value={jsonSchema}
                readOnly
                showFormatButton={false}
              />
              {parseError && <ErrorMessage message={parseError.message} />}
              {validationError && <ErrorMessage message={validationError} />}
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between p-4 pt-2">
              <Button variant="secondary" className="flex items-center gap-x-0.5" onClick={onBack}>
                <RiArrowLeftLine className="h-4 w-4" />
                <span>{t('nodes.llm.jsonSchema.back', { ns: 'workflow' })}</span>
              </Button>
              <div className="flex items-center gap-x-2">
                <Button
                  variant="secondary"
                  className="flex items-center gap-x-0.5"
                  onClick={onRegenerate}
                >
                  <RiSparklingLine className="h-4 w-4" />
                  <span>{t('nodes.llm.jsonSchema.regenerate', { ns: 'workflow' })}</span>
                </Button>
                <Button variant="primary" onClick={handleApply}>
                  {t('nodes.llm.jsonSchema.apply', { ns: 'workflow' })}
                </Button>
              </div>
            </div>

          </>
        )
      }
    </div>
  )
}

export default React.memo(GeneratedResult)
