import type { FC } from 'react'
import type { DocType } from '@/models/datasets'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Radio from '@/app/components/base/radio'
import { CUSTOMIZABLE_DOC_TYPES } from '@/models/datasets'
import s from '../style.module.css'
import IconButton from './icon-button'

export type DocTypeSelectorProps = {
  documentType?: DocType | ''
  tempDocType: DocType | ''
  doc_type: string
  onTempDocTypeChange: (type: DocType | '') => void
  onConfirm: () => void
  onCancel: () => void
}

const DocTypeSelector: FC<DocTypeSelectorProps> = ({
  documentType,
  tempDocType,
  doc_type,
  onTempDocTypeChange,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation()
  const isFirstTime = !doc_type && !documentType
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
              <IconButton
                type={type}
                isChecked={currValue === type}
              />
            </Radio>
          ))}
        </Radio.Group>
        {isFirstTime && (
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={!tempDocType}
          >
            {t('metadata.firstMetaAction', { ns: 'datasetDocuments' })}
          </Button>
        )}
        {documentType && (
          <div className={s.opBtnWrapper}>
            <Button onClick={onConfirm} className={`${s.opBtn} ${s.opSaveBtn}`} variant="primary">{t('operation.save', { ns: 'common' })}</Button>
            <Button onClick={onCancel} className={`${s.opBtn} ${s.opCancelBtn}`}>{t('operation.cancel', { ns: 'common' })}</Button>
          </div>
        )}
      </div>
    </>
  )
}

export default memo(DocTypeSelector)
