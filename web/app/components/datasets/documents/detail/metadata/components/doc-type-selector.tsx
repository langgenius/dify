'use client'
import type { FC } from 'react'
import type { DocType } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldItem, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { FieldsetLegend, FieldsetRoot } from '@langgenius/dify-ui/fieldset'
import { Radio } from '@langgenius/dify-ui/radio'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { useMetadataMap } from '@/hooks/use-metadata'
import { CUSTOMIZABLE_DOC_TYPES } from '@/models/datasets'
import s from '../style.module.css'

const TypeIcon: FC<{ iconName: string, className?: string }> = ({ iconName, className = '' }) => {
  return <div className={cn(s.commonIcon, s[`${iconName}Icon`], className)} />
}

const IconButton: FC<{ type: DocType, isChecked: boolean }> = ({ type, isChecked = false }) => {
  const metadataMap = useMetadataMap()
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span className={cn(s.iconWrapper, 'group', isChecked ? s.iconCheck : '')}>
            <TypeIcon
              iconName={metadataMap[type].iconName || ''}
              className={`group-hover:bg-primary-600 ${isChecked ? 'bg-primary-600!' : ''}`}
            />
          </span>
        )}
      />
      <TooltipContent>
        {metadataMap[type].text}
      </TooltipContent>
    </Tooltip>
  )
}

type DocTypeSelectorProps = {
  docType: DocType | ''
  documentType?: DocType | ''
  tempDocType: DocType | ''
  onTempDocTypeChange: (type: DocType | '') => void
  onConfirm: () => void
  onCancel: () => void
}

const DocTypeSelector: FC<DocTypeSelectorProps> = ({
  docType,
  documentType,
  tempDocType,
  onTempDocTypeChange,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  const metadataMap = useMetadataMap()
  const isFirstTime = !docType && !documentType
  const currValue = tempDocType ?? documentType

  return (
    <>
      {isFirstTime && (
        <div className={s.desc}>{t('metadata.desc', { ns: 'datasetDocuments' })}</div>
      )}
      <div className={s.operationWrapper}>
        <FieldRoot name="document_type" className="contents">
          <FieldsetRoot
            render={(
              <RadioGroup
                value={currValue ?? ''}
                onValueChange={onTempDocTypeChange}
                className={s.radioGroup}
              />
            )}
          >
            <FieldsetLegend className={s.title}>
              {isFirstTime
                ? t('metadata.docTypeSelectTitle', { ns: 'datasetDocuments' })
                : t('metadata.docTypeChangeTitle', { ns: 'datasetDocuments' })}
            </FieldsetLegend>
            {documentType && (
              <span className={s.changeTip}>{t('metadata.docTypeSelectWarning', { ns: 'datasetDocuments' })}</span>
            )}
            {CUSTOMIZABLE_DOC_TYPES.map(type => (
              <FieldItem key={type}>
                <FieldLabel
                  className={cn(
                    s.radio,
                    'focus-within:ring-2 focus-within:ring-components-input-border-hover focus-within:ring-offset-1 focus-within:outline-hidden',
                    currValue === type && 'shadow-none',
                  )}
                >
                  <Radio
                    value={type}
                    aria-label={metadataMap[type].text}
                    className="sr-only"
                  />
                  <IconButton type={type} isChecked={currValue === type} />
                </FieldLabel>
              </FieldItem>
            ))}
          </FieldsetRoot>
        </FieldRoot>
        {isFirstTime && (
          <Button variant="primary" onClick={onConfirm} disabled={!tempDocType}>
            {t('metadata.firstMetaAction', { ns: 'datasetDocuments' })}
          </Button>
        )}
        {documentType && (
          <div className={s.opBtnWrapper}>
            <Button onClick={onConfirm} className={`${s.opBtn} ${s.opSaveBtn}`} variant="primary">
              {t('operation.save', { ns: 'common' })}
            </Button>
            <Button onClick={onCancel} className={`${s.opBtn} ${s.opCancelBtn}`}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

type DocumentTypeDisplayProps = {
  displayType: DocType | ''
  showChangeLink?: boolean
  onChangeClick?: () => void
}

export const DocumentTypeDisplay: FC<DocumentTypeDisplayProps> = ({
  displayType,
  showChangeLink = false,
  onChangeClick,
}) => {
  const { t } = useTranslation()
  const metadataMap = useMetadataMap()
  const effectiveType = displayType || 'book'

  return (
    <div className={s.documentTypeShow}>
      {(displayType || !showChangeLink) && (
        <>
          <TypeIcon iconName={metadataMap[effectiveType]?.iconName || ''} className={s.iconShow} />
          {metadataMap[effectiveType].text}
          {showChangeLink && (
            <div className="ml-1 inline-flex items-center gap-1">
              ·
              <button
                type="button"
                className="inline cursor-pointer border-none bg-transparent p-0 text-left hover:text-text-accent"
                onClick={onChangeClick}
              >
                {t('operation.change', { ns: 'common' })}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DocTypeSelector
