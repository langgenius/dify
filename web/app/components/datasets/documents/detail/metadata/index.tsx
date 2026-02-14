'use client'
import type { FC } from 'react'
import type { FullDocumentDetail } from '@/models/datasets'
import { PencilIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import { useMetadataMap } from '@/hooks/use-metadata'
import DocTypeSelector, { DocumentTypeDisplay } from './components/doc-type-selector'
import MetadataFieldList from './components/metadata-field-list'
import { useMetadataState } from './hooks/use-metadata-state'
import s from './style.module.css'

export { default as FieldInfo } from './components/field-info'

type MetadataProps = {
  docDetail?: FullDocumentDetail
  loading: boolean
  onUpdate: () => void
}

const Metadata: FC<MetadataProps> = ({ docDetail, loading, onUpdate }) => {
  const { t } = useTranslation()
  const metadataMap = useMetadataMap()

  const {
    docType,
    editStatus,
    showDocTypes,
    tempDocType,
    saveLoading,
    metadataParams,
    setTempDocType,
    setShowDocTypes,
    confirmDocType,
    cancelDocType,
    enableEdit,
    cancelEdit,
    saveMetadata,
    updateMetadataField,
  } = useMetadataState({ docDetail, onUpdate })

  if (loading) {
    return (
      <div className={`${s.main} bg-gray-25`}>
        <Loading type="app" />
      </div>
    )
  }

  return (
    <div className={`${s.main} ${editStatus ? 'bg-white' : 'bg-gray-25'}`}>
      {/* Header: title + action buttons */}
      <div className={s.titleWrapper}>
        <span className={s.title}>{t('metadata.title', { ns: 'datasetDocuments' })}</span>
        {!editStatus
          ? (
              <Button onClick={enableEdit} className={`${s.opBtn} ${s.opEditBtn}`}>
                <PencilIcon className={s.opIcon} />
                {t('operation.edit', { ns: 'common' })}
              </Button>
            )
          : !showDocTypes && (
              <div className={s.opBtnWrapper}>
                <Button onClick={cancelEdit} className={`${s.opBtn} ${s.opCancelBtn}`}>
                  {t('operation.cancel', { ns: 'common' })}
                </Button>
                <Button onClick={saveMetadata} className={`${s.opBtn} ${s.opSaveBtn}`} variant="primary" loading={saveLoading}>
                  {t('operation.save', { ns: 'common' })}
                </Button>
              </div>
            )}
      </div>

      {/* Document type display / selector */}
      {!editStatus
        ? <DocumentTypeDisplay displayType={docType} />
        : showDocTypes
          ? null
          : (
              <DocumentTypeDisplay
                displayType={metadataParams.documentType || ''}
                showChangeLink={editStatus}
                onChangeClick={() => setShowDocTypes(true)}
              />
            )}

      {/* Divider between type display and fields (skip when in first-time selection) */}
      {(!docType && showDocTypes) ? null : <Divider />}

      {/* Doc type selector or editable metadata fields */}
      {showDocTypes
        ? (
            <DocTypeSelector
              docType={docType}
              documentType={metadataParams.documentType}
              tempDocType={tempDocType}
              onTempDocTypeChange={setTempDocType}
              onConfirm={confirmDocType}
              onCancel={cancelDocType}
            />
          )
        : (
            <MetadataFieldList
              mainField={metadataParams.documentType || ''}
              canEdit={editStatus}
              metadata={metadataParams.metadata}
              docDetail={docDetail}
              onFieldUpdate={updateMetadataField}
            />
          )}

      {/* Fixed fields: origin info */}
      <Divider />
      <MetadataFieldList mainField="originInfo" docDetail={docDetail} />

      {/* Fixed fields: technical parameters */}
      <div className={`${s.title} mt-8`}>{metadataMap.technicalParameters.text}</div>
      <Divider />
      <MetadataFieldList mainField="technicalParameters" docDetail={docDetail} />
    </div>
  )
}

export default Metadata
