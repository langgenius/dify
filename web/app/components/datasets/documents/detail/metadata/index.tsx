'use client'
import type { FC } from 'react'
import type { metadataType } from '@/hooks/use-metadata'
import type { FullDocumentDetail } from '@/models/datasets'
import { PencilIcon } from '@heroicons/react/24/outline'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Loading from '@/app/components/base/loading'
import { useMetadataMap } from '@/hooks/use-metadata'
import { useDocumentContext } from '../context'
import { DocTypeSelector, MetadataFieldList, TypeIcon } from './components'
import { useMetadataEditor, useMetadataSave } from './hooks'
import s from './style.module.css'

export { FieldInfo } from './components'

type MetadataProps = {
  docDetail?: FullDocumentDetail
  loading: boolean
  onUpdate: () => void
}

const Metadata: FC<MetadataProps> = ({ docDetail, loading, onUpdate }) => {
  const { t } = useTranslation()
  const metadataMap = useMetadataMap()
  const datasetId = useDocumentContext(state => state.datasetId)
  const documentId = useDocumentContext(state => state.documentId)

  const {
    doc_type,
    editStatus,
    setEditStatus,
    metadataParams,
    showDocTypes,
    tempDocType,
    setTempDocType,
    confirmDocType,
    cancelDocType,
    enableEdit,
    resetToInitial,
    updateMetadataField,
    openDocTypeSelector,
  } = useMetadataEditor({ docDetail })

  const { saveLoading, handleSave } = useMetadataSave({
    datasetId,
    documentId,
    metadataParams,
    doc_type,
    onSuccess: () => setEditStatus(false),
    onUpdate,
  })

  const renderDocTypeDisplay = () => {
    const docTypeKey = (doc_type || 'book') as metadataType
    if (!editStatus) {
      return (
        <div className={s.documentTypeShow}>
          <TypeIcon iconName={metadataMap[docTypeKey]?.iconName || ''} className={s.iconShow} />
          {metadataMap[docTypeKey].text}
        </div>
      )
    }

    if (showDocTypes)
      return null

    return (
      <div className={s.documentTypeShow}>
        {metadataParams.documentType && (
          <>
            <TypeIcon iconName={metadataMap[metadataParams.documentType || 'book'].iconName || ''} className={s.iconShow} />
            {metadataMap[metadataParams.documentType || 'book'].text}
            {editStatus && (
              <div className="ml-1 inline-flex items-center gap-1">
                ·
                <div
                  onClick={openDocTypeSelector}
                  className="cursor-pointer hover:text-text-accent"
                >
                  {t('operation.change', { ns: 'common' })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const renderHeaderActions = () => {
    if (!editStatus) {
      return (
        <Button onClick={enableEdit} className={`${s.opBtn} ${s.opEditBtn}`}>
          <PencilIcon className={s.opIcon} />
          {t('operation.edit', { ns: 'common' })}
        </Button>
      )
    }

    if (showDocTypes)
      return null

    return (
      <div className={s.opBtnWrapper}>
        <Button onClick={resetToInitial} className={`${s.opBtn} ${s.opCancelBtn}`}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button
          onClick={handleSave}
          className={`${s.opBtn} ${s.opSaveBtn}`}
          variant="primary"
          loading={saveLoading}
        >
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    )
  }

  return (
    <div className={`${s.main} ${editStatus ? 'bg-white' : 'bg-gray-25'}`}>
      {loading
        ? (<Loading type="app" />)
        : (
            <>
              <div className={s.titleWrapper}>
                <span className={s.title}>{t('metadata.title', { ns: 'datasetDocuments' })}</span>
                {renderHeaderActions()}
              </div>
              {renderDocTypeDisplay()}
              {(!doc_type && showDocTypes) ? null : <Divider />}
              {showDocTypes
                ? (
                    <DocTypeSelector
                      documentType={metadataParams.documentType}
                      tempDocType={tempDocType}
                      doc_type={doc_type}
                      onTempDocTypeChange={setTempDocType}
                      onConfirm={confirmDocType}
                      onCancel={cancelDocType}
                    />
                  )
                : (
                    <MetadataFieldList
                      mainField={metadataParams.documentType || ''}
                      canEdit={editStatus}
                      docDetail={docDetail}
                      metadataParams={metadataParams}
                      onUpdateField={updateMetadataField}
                    />
                  )}
              <Divider />
              <MetadataFieldList
                mainField="originInfo"
                canEdit={false}
                docDetail={docDetail}
                metadataParams={metadataParams}
                onUpdateField={updateMetadataField}
              />
              <div className={`${s.title} mt-8`}>{metadataMap.technicalParameters.text}</div>
              <Divider />
              <MetadataFieldList
                mainField="technicalParameters"
                canEdit={false}
                docDetail={docDetail}
                metadataParams={metadataParams}
                onUpdateField={updateMetadataField}
              />
            </>
          )}
    </div>
  )
}

export default Metadata
