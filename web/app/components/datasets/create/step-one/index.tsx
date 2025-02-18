'use client'
import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightLine, RiFolder6Line } from '@remixicon/react'
import FilePreview from '../file-preview'
import FileUploader from '../file-uploader'
import NotionPagePreview from '../notion-page-preview'
import EmptyDatasetCreationModal from '../empty-dataset-creation-modal'
import Website from '../website'
import WebsitePreview from '../website/preview'
import s from './index.module.css'
import cn from '@/utils/classnames'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import { DataSourceType } from '@/models/datasets'
import Button from '@/app/components/base/button'
import { NotionPageSelector } from '@/app/components/base/notion-page-selector'
import { useDatasetDetailContext } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import classNames from '@/utils/classnames'

type IStepOneProps = {
  datasetId?: string
  dataSourceType?: DataSourceType
  dataSourceTypeDisable: boolean
  hasConnection: boolean
  onSetting: () => void
  files: FileItem[]
  updateFileList: (files: FileItem[]) => void
  updateFile: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  notionPages?: NotionPage[]
  updateNotionPages: (value: NotionPage[]) => void
  onStepChange: () => void
  changeType: (type: DataSourceType) => void
  websitePages?: CrawlResultItem[]
  updateWebsitePages: (value: CrawlResultItem[]) => void
  onWebsiteCrawlProviderChange: (provider: DataSourceProvider) => void
  onWebsiteCrawlJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
}

type NotionConnectorProps = {
  onSetting: () => void
}
export const NotionConnector = ({ onSetting }: NotionConnectorProps) => {
  const { t } = useTranslation()

  return (
    <div className={s.notionConnectionTip}>
      <span className={s.notionIcon} />
      <div className={s.title}>{t('datasetCreation.stepOne.notionSyncTitle')}</div>
      <div className={s.tip}>{t('datasetCreation.stepOne.notionSyncTip')}</div>
      <Button className='h-8' variant='primary' onClick={onSetting}>{t('datasetCreation.stepOne.connect')}</Button>
    </div>
  )
}

const StepOne = ({
  datasetId,
  dataSourceType: inCreatePageDataSourceType,
  dataSourceTypeDisable,
  changeType,
  hasConnection,
  onSetting,
  onStepChange,
  files,
  updateFileList,
  updateFile,
  notionPages = [],
  updateNotionPages,
  websitePages = [],
  updateWebsitePages,
  onWebsiteCrawlProviderChange,
  onWebsiteCrawlJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
}: IStepOneProps) => {
  const { dataset } = useDatasetDetailContext()
  const [showModal, setShowModal] = useState(false)
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()
  const { t } = useTranslation()

  const modalShowHandle = () => setShowModal(true)
  const modalCloseHandle = () => setShowModal(false)

  const updateCurrentFile = (file: File) => {
    setCurrentFile(file)
  }
  const hideFilePreview = () => {
    setCurrentFile(undefined)
  }

  const updateCurrentPage = (page: NotionPage) => {
    setCurrentNotionPage(page)
  }

  const hideNotionPagePreview = () => {
    setCurrentNotionPage(undefined)
  }

  const hideWebsitePreview = () => {
    setCurrentWebsite(undefined)
  }

  const shouldShowDataSourceTypeList = !datasetId || (datasetId && !dataset?.data_source_type)
  const isInCreatePage = shouldShowDataSourceTypeList
  const dataSourceType = isInCreatePage ? inCreatePageDataSourceType : dataset?.data_source_type
  const { plan, enableBilling } = useProviderContext()
  const allFileLoaded = (files.length > 0 && files.every(file => file.file.id))
  const hasNotin = notionPages.length > 0
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = (allFileLoaded || hasNotin) && isVectorSpaceFull && enableBilling
  const notSupportBatchUpload = enableBilling && plan.type === 'sandbox'
  const nextDisabled = useMemo(() => {
    if (!files.length)
      return true
    if (files.some(file => !file.file.id))
      return true
    if (isShowVectorSpaceFull)
      return true
    return false
  }, [files, isShowVectorSpaceFull])

  return (
    <div className='flex h-full w-full'>
      <div className='relative h-full w-1/2 overflow-y-auto'>
        <div className='flex justify-end'>
          <div className={classNames(s.form)}>
            {
              shouldShowDataSourceTypeList && (
                <div className={classNames(s.stepHeader, 'z-10 text-text-secondary bg-components-panel-bg-blur')}>{t('datasetCreation.steps.one')}</div>
              )
            }
            {
              shouldShowDataSourceTypeList && (
                <div className='mb-8 flex flex-wrap items-center gap-4'>
                  <div
                    className={cn(
                      s.dataSourceItem,
                      dataSourceType === DataSourceType.FILE && s.active,
                      dataSourceTypeDisable && dataSourceType !== DataSourceType.FILE && s.disabled,
                    )}
                    onClick={() => {
                      if (dataSourceTypeDisable)
                        return
                      changeType(DataSourceType.FILE)
                      hideFilePreview()
                      hideNotionPagePreview()
                    }}
                  >
                    <span className={cn(s.datasetIcon)} />
                    {t('datasetCreation.stepOne.dataSourceType.file')}
                  </div>
                  <div
                    className={cn(
                      s.dataSourceItem,
                      dataSourceType === DataSourceType.NOTION && s.active,
                      dataSourceTypeDisable && dataSourceType !== DataSourceType.NOTION && s.disabled,
                    )}
                    onClick={() => {
                      if (dataSourceTypeDisable)
                        return
                      changeType(DataSourceType.NOTION)
                      hideFilePreview()
                      hideNotionPagePreview()
                    }}
                  >
                    <span className={cn(s.datasetIcon, s.notion)} />
                    {t('datasetCreation.stepOne.dataSourceType.notion')}
                  </div>
                  <div
                    className={cn(
                      s.dataSourceItem,
                      dataSourceType === DataSourceType.WEB && s.active,
                      dataSourceTypeDisable && dataSourceType !== DataSourceType.WEB && s.disabled,
                    )}
                    onClick={() => changeType(DataSourceType.WEB)}
                  >
                    <span className={cn(s.datasetIcon, s.web)} />
                    {t('datasetCreation.stepOne.dataSourceType.web')}
                  </div>
                </div>
              )
            }
            {dataSourceType === DataSourceType.FILE && (
              <>
                <FileUploader
                  fileList={files}
                  titleClassName={!shouldShowDataSourceTypeList ? 'mt-[30px] !mb-[44px] !text-lg !font-semibold !text-gray-900' : undefined}
                  prepareFileList={updateFileList}
                  onFileListUpdate={updateFileList}
                  onFileUpdate={updateFile}
                  onPreview={updateCurrentFile}
                  notSupportBatchUpload={notSupportBatchUpload}
                />
                {isShowVectorSpaceFull && (
                  <div className='mb-4 max-w-[640px]'>
                    <VectorSpaceFull />
                  </div>
                )}
                <div className="flex max-w-[640px] justify-end gap-2">
                  {/* <Button>{t('datasetCreation.stepOne.cancel')}</Button> */}
                  <Button disabled={nextDisabled} variant='primary' onClick={onStepChange}>
                    <span className="flex gap-0.5 px-[10px]">
                      <span className="px-0.5">{t('datasetCreation.stepOne.button')}</span>
                      <RiArrowRightLine className="size-4" />
                    </span>
                  </Button>
                </div>
              </>
            )}
            {dataSourceType === DataSourceType.NOTION && (
              <>
                {!hasConnection && <NotionConnector onSetting={onSetting} />}
                {hasConnection && (
                  <>
                    <div className='mb-8 w-[640px]'>
                      <NotionPageSelector
                        value={notionPages.map(page => page.page_id)}
                        onSelect={updateNotionPages}
                        onPreview={updateCurrentPage}
                      />
                    </div>
                    {isShowVectorSpaceFull && (
                      <div className='mb-4 max-w-[640px]'>
                        <VectorSpaceFull />
                      </div>
                    )}
                    <div className="flex max-w-[640px] justify-end gap-2">
                      {/* <Button>{t('datasetCreation.stepOne.cancel')}</Button> */}
                      <Button disabled={isShowVectorSpaceFull || !notionPages.length} variant='primary' onClick={onStepChange}>
                        <span className="flex gap-0.5 px-[10px]">
                          <span className="px-0.5">{t('datasetCreation.stepOne.button')}</span>
                          <RiArrowRightLine className="size-4" />
                        </span>
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
            {dataSourceType === DataSourceType.WEB && (
              <>
                <div className={cn('mb-8 w-[640px]', !shouldShowDataSourceTypeList && 'mt-12')}>
                  <Website
                    onPreview={setCurrentWebsite}
                    checkedCrawlResult={websitePages}
                    onCheckedCrawlResultChange={updateWebsitePages}
                    onCrawlProviderChange={onWebsiteCrawlProviderChange}
                    onJobIdChange={onWebsiteCrawlJobIdChange}
                    crawlOptions={crawlOptions}
                    onCrawlOptionsChange={onCrawlOptionsChange}
                  />
                </div>
                {isShowVectorSpaceFull && (
                  <div className='mb-4 max-w-[640px]'>
                    <VectorSpaceFull />
                  </div>
                )}
                <div className="flex max-w-[640px] justify-end gap-2">
                  {/* <Button>{t('datasetCreation.stepOne.cancel')}</Button> */}
                  <Button disabled={isShowVectorSpaceFull || !websitePages.length} variant='primary' onClick={onStepChange}>
                    <span className="flex gap-0.5 px-[10px]">
                      <span className="px-0.5">{t('datasetCreation.stepOne.button')}</span>
                      <RiArrowRightLine className="size-4" />
                    </span>
                  </Button>
                </div>
              </>
            )}
            {!datasetId && (
              <>
                <div className={s.dividerLine} />
                <span className="text-text-accent inline-flex cursor-pointer items-center text-[13px] leading-4" onClick={modalShowHandle}>
                  <RiFolder6Line className="mr-1 size-4" />
                  {t('datasetCreation.stepOne.emptyDatasetCreation')}
                </span>
              </>
            )}
          </div>
          <EmptyDatasetCreationModal show={showModal} onHide={modalCloseHandle} />
        </div>
      </div>
      <div className='h-full w-1/2 overflow-y-auto'>
        {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
        {currentNotionPage && <NotionPagePreview currentPage={currentNotionPage} hidePreview={hideNotionPagePreview} />}
        {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
      </div>
    </div>
  )
}

export default StepOne
