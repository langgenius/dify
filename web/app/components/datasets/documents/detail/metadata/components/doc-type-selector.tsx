'use client'
import type { FC } from 'react'
import type { DocType } from '@/models/datasets'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Radio from '@/app/components/base/radio'
import Tooltip from '@/app/components/base/tooltip'
import { useMetadataMap } from '@/hooks/use-metadata'
import { CUSTOMIZABLE_DOC_TYPES } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import s from '../style.module.css'

const TypeIcon: FC<{ iconName: string, className?: string }> = ({ iconName, className = '' }) => {
  return <div className={cn(s.commonIcon, s[`${iconName}Icon`], className)} />
}

const IconButton: FC<{ type: DocType, isChecked: boolean }> = ({ type, isChecked = false }) => {
  const metadataMap = useMetadataMap()
  return (
    <Tooltip popupContent={metadataMap[type].text}>
      <button type="button" className={cn(s.iconWrapper, 'group', isChecked ? s.iconCheck : '')}>
        <TypeIcon
          iconName={metadataMap[type].iconName || ''}
          className={`group-hover:bg-primary-600 ${isChecked ? '!bg-primary-600' : ''}`}
        />
      </button>
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
  const isFirstTime = !docType && !documentType
  const currValue = tempDocType ?? documentType

  return (
    <>
      {isFirstTime && (
        <div className={s.desc}>{t('metadata.desc', { ns: 'datasetDocuments' })}</div>
      )}
      <div className={s.operationWrapper}>
        {isFirstTime && (
          <span className={s.title}>{t('metadata.docTypeSelectTitle', { ns: 'datasetDocuments' })}</span>
        )}
        {documentType && (
          <>
            <span className={s.title}>{t('metadata.docTypeChangeTitle', { ns: 'datasetDocuments' })}</span>
            <span className={s.changeTip}>{t('metadata.docTypeSelectWarning', { ns: 'datasetDocuments' })}</span>
          </>
        )}
        <Radio.Group value={currValue ?? ''} onChange={onTempDocTypeChange} className={s.radioGroup}>
          {CUSTOMIZABLE_DOC_TYPES.map(type => (
            <Radio key={type} value={type} className={`${s.radio} ${currValue === type ? 'shadow-none' : ''}`}>
              <IconButton type={type} isChecked={currValue === type} />
            </Radio>
          ))}
        </Radio.Group>
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
              <div onClick={onChangeClick} className="cursor-pointer hover:text-text-accent">
                {t('operation.change', { ns: 'common' })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DocTypeSelector
