'use client'
import React, { useCallback, useMemo, useState } from 'react'
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
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import VectorSpaceFull from '@/app/components/billing/vector-space-full'
import classNames from '@/utils/classnames'
import { ENABLE_WEBSITE_FIRECRAWL, ENABLE_WEBSITE_JINAREADER, ENABLE_WEBSITE_WATERCRAWL } from '@/config'
import NotionConnector from '@/app/components/base/notion-connector'
import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'

type IStepOneProps = {
  datasetId?: string
  dataSourceType?: DataSourceType
  dataSourceTypeDisable: boolean
  onSetting: () => void
  files: FileItem[]
  updateFileList: (files: FileItem[]) => void
  updateFile: (fileItem: FileItem, progress: number, list: FileItem[]) => void
  notionPages?: NotionPage[]
  notionCredentialId: string
  updateNotionPages: (value: NotionPage[]) => void
  updateNotionCredentialId: (credentialId: string) => void
  onStepChange: () => void
  changeType: (type: DataSourceType) => void
  websitePages?: CrawlResultItem[]
  updateWebsitePages: (value: CrawlResultItem[]) => void
  onWebsiteCrawlProviderChange: (provider: DataSourceProvider) => void
  onWebsiteCrawlJobIdChange: (jobId: string) => void
  crawlOptions: CrawlOptions
  onCrawlOptionsChange: (payload: CrawlOptions) => void
  authedDataSourceList: DataSourceAuth[]
}

const StepOne = ({
  datasetId,
  dataSourceType: inCreatePageDataSourceType,
  dataSourceTypeDisable,
  changeType,
  onSetting,
  onStepChange,
  files,
  updateFileList,
  updateFile,
  notionPages = [],
  notionCredentialId,
  updateNotionPages,
  updateNotionCredentialId,
  websitePages = [],
  updateWebsitePages,
  onWebsiteCrawlProviderChange,
  onWebsiteCrawlJobIdChange,
  crawlOptions,
  onCrawlOptionsChange,
  authedDataSourceList,
}: IStepOneProps) => {
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const [showModal, setShowModal] = useState(false)
  const [currentFile, setCurrentFile] = useState<File | undefined>()
  const [currentNotionPage, setCurrentNotionPage] = useState<NotionPage | undefined>()
  const [currentWebsite, setCurrentWebsite] = useState<CrawlResultItem | undefined>()
  const { t } = useTranslation()

  const modalShowHandle = () => setShowModal(true)
  const modalCloseHandle = () => setShowModal(false)

  const updateCurrentFile = useCallback((file: File) => {
    setCurrentFile(file)
  }, [])

  const hideFilePreview = useCallback(() => {
    setCurrentFile(undefined)
  }, [])

  const updateCurrentPage = useCallback((page: NotionPage) => {
    setCurrentNotionPage(page)
  }, [])

  const hideNotionPagePreview = useCallback(() => {
    setCurrentNotionPage(undefined)
  }, [])

  const updateWebsite = useCallback((website: CrawlResultItem) => {
    setCurrentWebsite(website)
  }, [])

  const hideWebsitePreview = useCallback(() => {
    setCurrentWebsite(undefined)
  }, [])

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
    return isShowVectorSpaceFull
  }, [files, isShowVectorSpaceFull])

  const isNotionAuthed = useMemo(() => {
    if (!authedDataSourceList) return false
    const notionSource = authedDataSourceList.find(item => item.provider === 'notion_datasource')
    if (!notionSource) return false
    return notionSource.credentials_list.length > 0
  }, [authedDataSourceList])

  const notionCredentialList = useMemo(() => {
    return authedDataSourceList.find(item => item.provider === 'notion_datasource')?.credentials_list || []
  }, [authedDataSourceList])

  return (
    <div className='h-full w-full overflow-x-auto'>
      <div className='flex h-full w-full min-w-[1440px]'>
        <div className='relative h-full w-1/2 overflow-y-auto'>
          <div className='flex justify-end'>
            <div className={classNames(s.form)}>
              {
                shouldShowDataSourceTypeList && (
                  <div className={classNames(s.stepHeader, 'system-md-semibold text-text-secondary')}>
                    {t('datasetCreation.steps.one')}
                  </div>
                )
              }
              {
                shouldShowDataSourceTypeList && (
                  <div className='mb-8 grid grid-cols-3 gap-4'>
                    <div
                      className={cn(
                        s.dataSourceItem,
                        'system-sm-medium',
                        dataSourceType === DataSourceType.FILE && s.active,
                        dataSourceTypeDisable && dataSourceType !== DataSourceType.FILE && s.disabled,
                      )}
                      onClick={() => {
                        if (dataSourceTypeDisable)
                          return
                        changeType(DataSourceType.FILE)
                        hideNotionPagePreview()
                        hideWebsitePreview()
                      }}
                    >
                      <span className={cn(s.datasetIcon)} />
                      <span
                        title={t('datasetCreation.stepOne.dataSourceType.file')!}
                        className='truncate'
                      >
                        {t('datasetCreation.stepOne.dataSourceType.file')}
                      </span>
                    </div>
                    <div
                      className={cn(
                        s.dataSourceItem,
                        'system-sm-medium',
                        dataSourceType === DataSourceType.NOTION && s.active,
                        dataSourceTypeDisable && dataSourceType !== DataSourceType.NOTION && s.disabled,
                      )}
                      onClick={() => {
                        if (dataSourceTypeDisable)
                          return
                        changeType(DataSourceType.NOTION)
                        hideFilePreview()
                        hideWebsitePreview()
                      }}
                    >
                      <span className={cn(s.datasetIcon, s.notion)} />
                      <span
                        title={t('datasetCreation.stepOne.dataSourceType.notion')!}
                        className='truncate'
                      >
                        {t('datasetCreation.stepOne.dataSourceType.notion')}
                      </span>
                    </div>
                    {(ENABLE_WEBSITE_FIRECRAWL || ENABLE_WEBSITE_JINAREADER || ENABLE_WEBSITE_WATERCRAWL) && (
                      <div
                        className={cn(
                          s.dataSourceItem,
                          'system-sm-medium',
                          dataSourceType === DataSourceType.WEB && s.active,
                          dataSourceTypeDisable && dataSourceType !== DataSourceType.WEB && s.disabled,
                        )}
                        onClick={() => {
                          if (dataSourceTypeDisable)
                            return
                          changeType(DataSourceType.WEB)
                          hideFilePreview()
                          hideNotionPagePreview()
                        }}
                      >
                        <span className={cn(s.datasetIcon, s.web)} />
                        <span
                          title={t('datasetCreation.stepOne.dataSourceType.web')!}
                          className='truncate'
                        >
                          {t('datasetCreation.stepOne.dataSourceType.web')}
                        </span>
                      </div>
                    )}
                  </div>
                )
              }
              {dataSourceType === DataSourceType.FILE && (
                <>
                  <FileUploader
                    fileList={files}
                    titleClassName={!shouldShowDataSourceTypeList ? 'mt-[30px] !mb-[44px] !text-lg' : undefined}
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
                  {!isNotionAuthed && <NotionConnector onSetting={onSetting} />}
                  {isNotionAuthed && (
                    <>
                      <div className='mb-8 w-[640px]'>
                        <NotionPageSelector
                          value={notionPages.map(page => page.page_id)}
                          onSelect={updateNotionPages}
                          onPreview={updateCurrentPage}
                          credentialList={notionCredentialList}
                          onSelectCredential={updateNotionCredentialId}
                          datasetId={datasetId}
                        />
                      </div>
                      {isShowVectorSpaceFull && (
                        <div className='mb-4 max-w-[640px]'>
                          <VectorSpaceFull />
                        </div>
                      )}
                      <div className="flex max-w-[640px] justify-end gap-2">
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
                      onPreview={updateWebsite}
                      checkedCrawlResult={websitePages}
                      onCheckedCrawlResultChange={updateWebsitePages}
                      onCrawlProviderChange={onWebsiteCrawlProviderChange}
                      onJobIdChange={onWebsiteCrawlJobIdChange}
                      crawlOptions={crawlOptions}
                      onCrawlOptionsChange={onCrawlOptionsChange}
                      authedDataSourceList={authedDataSourceList}
                    />
                  </div>
                  {isShowVectorSpaceFull && (
                    <div className='mb-4 max-w-[640px]'>
                      <VectorSpaceFull />
                    </div>
                  )}
                  <div className="flex max-w-[640px] justify-end gap-2">
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
                  <div className='my-8 h-px max-w-[640px] bg-divider-regular' />
                  <span className="inline-flex cursor-pointer items-center text-[13px] leading-4 text-text-accent" onClick={modalShowHandle}>
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
          {currentNotionPage && (
            <NotionPagePreview
              currentPage={currentNotionPage}
              hidePreview={hideNotionPagePreview}
              notionCredentialId={notionCredentialId}
            />
          )}
          {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
        </div>
      </div>
    </div>
  )
}

export default StepOne
