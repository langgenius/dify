'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import FilePreview from '../file-preview'
import FileUploader from '../file-uploader'
import EmptyDatasetCreationModal from '../empty-dataset-creation-modal'
import s from './index.module.css'
import type { File } from '@/models/datasets'
import { DataSourceType } from '@/models/datasets'
import Button from '@/app/components/base/button'
import { NotionPageSelector } from '@/app/components/base/notion-page-selector'

type IStepOneProps = {
  datasetId?: string
  dataSourceType: DataSourceType
  hasConnection: boolean
  onSetting: () => void
  file?: File
  updateFile: (file?: File) => void
  notionPages?: any[]
  updateNotionPages: (value: any[]) => void
  onStepChange: () => void
  changeType: (type: DataSourceType) => void
}

const StepOne = ({
  datasetId,
  dataSourceType,
  changeType,
  hasConnection,
  onSetting,
  onStepChange,
  file,
  updateFile,
  notionPages = [],
}: IStepOneProps) => {
  const [showModal, setShowModal] = useState(false)
  const [showFilePreview, setShowFilePreview] = useState(true)
  const { t } = useTranslation()

  const hidePreview = () => setShowFilePreview(false)

  const modalShowHandle = () => setShowModal(true)

  const modalCloseHandle = () => setShowModal(false)

  return (
    <div className='flex w-full h-full'>
      <div className='grow overflow-y-auto relative'>
        <div className={s.stepHeader}>{t('datasetCreation.steps.one')}</div>
        <div className={s.form}>
          <div className={s.dataSourceTypeList}>
            <div
              className={cn(s.dataSourceItem, dataSourceType === DataSourceType.FILE && s.active)}
              onClick={() => changeType(DataSourceType.FILE)}
            >
              <span className={cn(s.datasetIcon)} />
              {t('datasetCreation.stepOne.dataSourceType.file')}
            </div>
            <div
              className={cn(s.dataSourceItem, dataSourceType === DataSourceType.NOTION && s.active)}
              onClick={() => changeType(DataSourceType.NOTION)}
            >
              <span className={cn(s.datasetIcon, s.notion)} />
              {t('datasetCreation.stepOne.dataSourceType.notion')}
            </div>
            <div
              className={cn(s.dataSourceItem, s.disabled, dataSourceType === DataSourceType.WEB && s.active)}
            // onClick={() => changeType(DataSourceType.WEB)}
            >
              <span className={s.comingTag}>Coming soon</span>
              <span className={cn(s.datasetIcon, s.web)} />
              {t('datasetCreation.stepOne.dataSourceType.web')}
            </div>
          </div>
          {dataSourceType === DataSourceType.FILE && (
            <>
              <FileUploader onFileUpdate={updateFile} file={file} />
              <Button disabled={!file} className={s.submitButton} type='primary' onClick={onStepChange}>{t('datasetCreation.stepOne.button')}</Button>
            </>
          )}
          {dataSourceType === DataSourceType.NOTION && (
            <>
              {!hasConnection && (
                <div className={s.notionConnectionTip}>
                  <span className={s.notionIcon}/>
                  <div className={s.title}>Notion is not connected</div>
                  <div className={s.tip}>To sync with Notion, connection to Notion must be established first.</div>
                  <Button className='h-8' type='primary' onClick={onSetting}>Go to connect</Button>
                </div>
              )}
              {hasConnection && (
                <>
                  {/* TODO */}
                  <div className='mb-8 w-[640px]'>
                    <NotionPageSelector />
                  </div>
                  <Button disabled={!notionPages.length} className={s.submitButton} type='primary' onClick={onStepChange}>{t('datasetCreation.stepOne.button')}</Button>
                </>
              )}
            </>
          )}
          {!datasetId && (
            <>
              <div className={s.dividerLine} />
              <div onClick={modalShowHandle} className={s.OtherCreationOption}>{t('datasetCreation.stepOne.emptyDatasetCreation')}</div>
            </>
          )}
        </div>
        <EmptyDatasetCreationModal show={showModal} onHide={modalCloseHandle} />
      </div>
      {file && showFilePreview && <FilePreview file={file} hidePreview={hidePreview} />}
      {/* TODO notion page preview */}
    </div>
  )
}

export default StepOne
