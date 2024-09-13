'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { PencilIcon } from '@heroicons/react/24/outline'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { get } from 'lodash-es'
import { DocumentContext } from '../index'
import s from './style.module.css'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import Radio from '@/app/components/base/radio'
import Divider from '@/app/components/base/divider'
import { ToastContext } from '@/app/components/base/toast'
import { SimpleSelect } from '@/app/components/base/select'
import Loading from '@/app/components/base/loading'
import AutoHeightTextarea from '@/app/components/base/auto-height-textarea'
import { asyncRunSafe, getTextWidthWithCanvas } from '@/utils'
import { modifyDocMetadata } from '@/service/datasets'
import type { CommonResponse } from '@/models/common'
import type { DocType, FullDocumentDetail } from '@/models/datasets'
import { CUSTOMIZABLE_DOC_TYPES } from '@/models/datasets'
import type { inputType, metadataType } from '@/hooks/use-metadata'
import { useBookCategories, useBusinessDocCategories, useLanguages, useMetadataMap, usePersonalDocCategories } from '@/hooks/use-metadata'

const map2Options = (map: { [key: string]: string }) => {
  return Object.keys(map).map(key => ({ value: key, name: map[key] }))
}

type IFieldInfoProps = {
  label: string
  value?: string
  displayedValue?: string
  defaultValue?: string
  showEdit?: boolean
  inputType?: inputType
  selectOptions?: Array<{ value: string; name: string }>
  onUpdate?: (v: any) => void
}

export const FieldInfo: FC<IFieldInfoProps> = ({
  label,
  value = '',
  displayedValue = '',
  defaultValue,
  showEdit = false,
  inputType = 'input',
  selectOptions = [],
  onUpdate,
}) => {
  const { t } = useTranslation()
  const textNeedWrap = getTextWidthWithCanvas(displayedValue) > 190
  const editAlignTop = showEdit && inputType === 'textarea'
  const readAlignTop = !showEdit && textNeedWrap

  return (
    <div className={cn(s.fieldInfo, editAlignTop && '!items-start', readAlignTop && '!items-start pt-1')}>
      <div className={cn(s.label, editAlignTop && 'pt-1')}>{label}</div>
      <div className={s.value}>
        {!showEdit
          ? displayedValue
          : inputType === 'select'
            ? <SimpleSelect
              onSelect={({ value }) => onUpdate && onUpdate(value as string)}
              items={selectOptions}
              defaultValue={value}
              className={s.select}
              wrapperClassName={s.selectWrapper}
              placeholder={`${t('datasetDocuments.metadata.placeholder.select')}${label}`}
            />
            : inputType === 'textarea'
              ? <AutoHeightTextarea
                onChange={e => onUpdate && onUpdate(e.target.value)}
                value={value}
                className={s.textArea}
                placeholder={`${t('datasetDocuments.metadata.placeholder.add')}${label}`}
              />
              : <Input
                className={s.input}
                onChange={e => onUpdate?.(e.target.value)}
                value={value}
                defaultValue={defaultValue}
                placeholder={`${t('datasetDocuments.metadata.placeholder.add')}${label}`}
              />
        }
      </div>
    </div>
  )
}

const TypeIcon: FC<{ iconName: string; className?: string }> = ({ iconName, className = '' }) => {
  return <div className={cn(s.commonIcon, s[`${iconName}Icon`], className)}
  />
}

const IconButton: FC<{
  type: DocType
  isChecked: boolean
}> = ({ type, isChecked = false }) => {
  const metadataMap = useMetadataMap()

  return (
    <Tooltip
      popupContent={metadataMap[type].text}
    >
      <button className={cn(s.iconWrapper, 'group', isChecked ? s.iconCheck : '')}>
        <TypeIcon
          iconName={metadataMap[type].iconName || ''}
          className={`group-hover:bg-primary-600 ${isChecked ? '!bg-primary-600' : ''}`}
        />
      </button>
    </Tooltip>
  )
}

type IMetadataProps = {
  docDetail?: FullDocumentDetail
  loading: boolean
  onUpdate: () => void
}

const Metadata: FC<IMetadataProps> = ({ docDetail, loading, onUpdate }) => {
  const { doc_metadata = {} } = docDetail || {}
  const doc_type = docDetail?.doc_type || ''

  const { t } = useTranslation()
  const metadataMap = useMetadataMap()
  const languageMap = useLanguages()
  const bookCategoryMap = useBookCategories()
  const personalDocCategoryMap = usePersonalDocCategories()
  const businessDocCategoryMap = useBusinessDocCategories()
  const [editStatus, setEditStatus] = useState(!doc_type) // if no documentType, in editing status by default
  // the initial values are according to the documentType
  const [metadataParams, setMetadataParams] = useState<{
    documentType?: DocType | ''
    metadata: { [key: string]: string }
  }>(
    doc_type
      ? {
        documentType: doc_type,
        metadata: doc_metadata || {},
      }
      : { metadata: {} })
  const [showDocTypes, setShowDocTypes] = useState(!doc_type) // whether show doc types
  const [tempDocType, setTempDocType] = useState<DocType | undefined | ''>('') // for remember icon click
  const [saveLoading, setSaveLoading] = useState(false)

  const { notify } = useContext(ToastContext)
  const { datasetId = '', documentId = '' } = useContext(DocumentContext)

  useEffect(() => {
    if (docDetail?.doc_type) {
      setEditStatus(false)
      setShowDocTypes(false)
      setTempDocType(docDetail?.doc_type)
      setMetadataParams({
        documentType: docDetail?.doc_type,
        metadata: docDetail?.doc_metadata || {},
      })
    }
  }, [docDetail?.doc_type])

  // confirm doc type
  const confirmDocType = () => {
    if (!tempDocType)
      return
    setMetadataParams({
      documentType: tempDocType,
      metadata: tempDocType === metadataParams.documentType ? metadataParams.metadata : {}, // change doc type, clear metadata
    })
    setEditStatus(true)
    setShowDocTypes(false)
  }

  // cancel doc type
  const cancelDocType = () => {
    setTempDocType(metadataParams.documentType)
    setEditStatus(true)
    setShowDocTypes(false)
  }

  // show doc type select
  const renderSelectDocType = () => {
    const { documentType } = metadataParams

    return (
      <>
        {!doc_type && !documentType && <>
          <div className={s.desc}>{t('datasetDocuments.metadata.desc')}</div>
        </>}
        <div className={s.operationWrapper}>
          {!doc_type && !documentType && <>
            <span className={s.title}>{t('datasetDocuments.metadata.docTypeSelectTitle')}</span>
          </>}
          {documentType && <>
            <span className={s.title}>{t('datasetDocuments.metadata.docTypeChangeTitle')}</span>
            <span className={s.changeTip}>{t('datasetDocuments.metadata.docTypeSelectWarning')}</span>
          </>}
          <Radio.Group value={tempDocType ?? documentType} onChange={setTempDocType} className={s.radioGroup}>
            {CUSTOMIZABLE_DOC_TYPES.map((type, index) => {
              const currValue = tempDocType ?? documentType
              return <Radio key={index} value={type} className={`${s.radio} ${currValue === type ? 'shadow-none' : ''}`}>
                <IconButton
                  type={type}
                  isChecked={currValue === type}
                />
              </Radio>
            })}
          </Radio.Group>
          {!doc_type && !documentType && (
            <Button variant='primary'
              onClick={confirmDocType}
              disabled={!tempDocType}
            >
              {t('datasetDocuments.metadata.firstMetaAction')}
            </Button>
          )}
          {documentType && <div className={s.opBtnWrapper}>
            <Button onClick={confirmDocType} className={`${s.opBtn} ${s.opSaveBtn}`} variant='primary' >{t('common.operation.save')}</Button>
            <Button onClick={cancelDocType} className={`${s.opBtn} ${s.opCancelBtn}`}>{t('common.operation.cancel')}</Button>
          </div>}
        </div >
      </>
    )
  }

  // show metadata info and edit
  const renderFieldInfos = ({ mainField = 'book', canEdit }: { mainField?: metadataType | ''; canEdit?: boolean }) => {
    if (!mainField)
      return null
    const fieldMap = metadataMap[mainField]?.subFieldsMap
    const sourceData = ['originInfo', 'technicalParameters'].includes(mainField) ? docDetail : metadataParams.metadata

    const getTargetMap = (field: string) => {
      if (field === 'language')
        return languageMap
      if (field === 'category' && mainField === 'book')
        return bookCategoryMap

      if (field === 'document_type') {
        if (mainField === 'personal_document')
          return personalDocCategoryMap
        if (mainField === 'business_document')
          return businessDocCategoryMap
      }
      return {} as any
    }

    const getTargetValue = (field: string) => {
      const val = get(sourceData, field, '')
      if (!val && val !== 0)
        return '-'
      if (fieldMap[field]?.inputType === 'select')
        return getTargetMap(field)[val]
      if (fieldMap[field]?.render)
        return fieldMap[field]?.render?.(val, field === 'hit_count' ? get(sourceData, 'segment_count', 0) as number : undefined)
      return val
    }

    return <div className='flex flex-col gap-1'>
      {Object.keys(fieldMap).map((field) => {
        return <FieldInfo
          key={fieldMap[field]?.label}
          label={fieldMap[field]?.label}
          displayedValue={getTargetValue(field)}
          value={get(sourceData, field, '')}
          inputType={fieldMap[field]?.inputType || 'input'}
          showEdit={canEdit}
          onUpdate={(val) => {
            setMetadataParams(pre => ({ ...pre, metadata: { ...pre.metadata, [field]: val } }))
          }}
          selectOptions={map2Options(getTargetMap(field))}
        />
      })}
    </div>
  }

  const enabledEdit = () => {
    setEditStatus(true)
  }

  const onCancel = () => {
    setMetadataParams({ documentType: doc_type || '', metadata: { ...(docDetail?.doc_metadata || {}) } })
    setEditStatus(!doc_type)
    if (!doc_type)
      setShowDocTypes(true)
  }

  const onSave = async () => {
    setSaveLoading(true)
    const [e] = await asyncRunSafe<CommonResponse>(modifyDocMetadata({
      datasetId,
      documentId,
      body: {
        doc_type: metadataParams.documentType || doc_type || '',
        doc_metadata: metadataParams.metadata,
      },
    }) as Promise<CommonResponse>)
    if (!e)
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    else
      notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    onUpdate?.()
    setEditStatus(false)
    setSaveLoading(false)
  }

  return (
    <div className={`${s.main} ${editStatus ? 'bg-white' : 'bg-gray-25'}`}>
      {loading
        ? (<Loading type='app' />)
        : (
          <>
            <div className={s.titleWrapper}>
              <span className={s.title}>{t('datasetDocuments.metadata.title')}</span>
              {!editStatus
                ? <Button onClick={enabledEdit} className={`${s.opBtn} ${s.opEditBtn}`}>
                  <PencilIcon className={s.opIcon} />
                  {t('common.operation.edit')}
                </Button>
                : showDocTypes
                  ? null
                  : <div className={s.opBtnWrapper}>
                    <Button onClick={onCancel} className={`${s.opBtn} ${s.opCancelBtn}`}>{t('common.operation.cancel')}</Button>
                    <Button onClick={onSave}
                      className={`${s.opBtn} ${s.opSaveBtn}`}
                      variant='primary'
                      loading={saveLoading}
                    >
                      {t('common.operation.save')}
                    </Button>
                  </div>}
            </div>
            {/* show selected doc type and changing entry */}
            {!editStatus
              ? <div className={s.documentTypeShow}>
                <TypeIcon iconName={metadataMap[doc_type || 'book']?.iconName || ''} className={s.iconShow} />
                {metadataMap[doc_type || 'book'].text}
              </div>
              : showDocTypes
                ? null
                : <div className={s.documentTypeShow}>
                  {metadataParams.documentType && <>
                    <TypeIcon iconName={metadataMap[metadataParams.documentType || 'book'].iconName || ''} className={s.iconShow} />
                    {metadataMap[metadataParams.documentType || 'book'].text}
                    {editStatus && <div className='inline-flex items-center gap-1 ml-1'>
                      ·
                      <div
                        onClick={() => { setShowDocTypes(true) }}
                        className='cursor-pointer hover:text-[#155EEF]'
                      >
                        {t('common.operation.change')}
                      </div>
                    </div>}
                  </>}
                </div>
            }
            {(!doc_type && showDocTypes) ? null : <Divider />}
            {showDocTypes ? renderSelectDocType() : renderFieldInfos({ mainField: metadataParams.documentType, canEdit: editStatus })}
            {/* show fixed fields */}
            <Divider />
            {renderFieldInfos({ mainField: 'originInfo', canEdit: false })}
            <div className={`${s.title} mt-8`}>{metadataMap.technicalParameters.text}</div>
            <Divider />
            {renderFieldInfos({ mainField: 'technicalParameters', canEdit: false })}
          </>
        )}
    </div>
  )
}

export default Metadata
