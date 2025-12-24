'use client'
import type { DataSourceAuth } from '@/app/components/header/account-setting/data-source-page-new/types'
import type { DataSourceProvider, NotionPage } from '@/models/common'
import type { CrawlOptions, CrawlResultItem, FileItem } from '@/models/datasets'
import { RiFolder6Line } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PlanUpgradeModal from '@/app/components/billing/plan-upgrade-modal'
import { Plan } from '@/app/components/billing/type'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useProviderContext } from '@/context/provider-context'
import { DataSourceType } from '@/models/datasets'
import { cn } from '@/utils/classnames'
import EmptyDatasetCreationModal from '../empty-dataset-creation-modal'
import FilePreview from '../file-preview'
import NotionPagePreview from '../notion-page-preview'
import WebsitePreview from '../website/preview'
import DataSourceSelector from './data-source-selector'
import { usePreview } from './hooks/use-preview'
import s from './index.module.css'
import { FileSource, NotionSource, WebSource } from './sources'

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
  onStepChange: doOnStepChange,
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
  const { t } = useTranslation()

  // Use custom hook for preview state management
  const {
    currentFile,
    currentNotionPage,
    currentWebsite,
    updateCurrentFile,
    hideFilePreview,
    updateCurrentPage,
    hideNotionPagePreview,
    updateWebsite,
    hideWebsitePreview,
  } = usePreview()

  const modalShowHandle = () => setShowModal(true)
  const modalCloseHandle = () => setShowModal(false)

  // Derived state
  const shouldShowDataSourceTypeList = Boolean(!datasetId || (datasetId && !dataset?.data_source_type))
  const isInCreatePage = shouldShowDataSourceTypeList
  const dataSourceType = isInCreatePage ? inCreatePageDataSourceType : dataset?.data_source_type

  // Billing related state
  const { plan, enableBilling } = useProviderContext()
  const allFileLoaded = files.length > 0 && files.every(file => file.file.id)
  const hasNotion = notionPages.length > 0
  const isVectorSpaceFull = plan.usage.vectorSpace >= plan.total.vectorSpace
  const isShowVectorSpaceFull = Boolean((allFileLoaded || hasNotion) && isVectorSpaceFull && enableBilling)
  const supportBatchUpload = !enableBilling || plan.type !== Plan.sandbox
  const notSupportBatchUpload = !supportBatchUpload

  const [isShowPlanUpgradeModal, {
    setTrue: showPlanUpgradeModal,
    setFalse: hidePlanUpgradeModal,
  }] = useBoolean(false)

  // Handle step change with batch upload validation
  const onStepChange = useCallback(() => {
    if (notSupportBatchUpload) {
      let isMultiple = false
      if (dataSourceType === DataSourceType.FILE && files.length > 1)
        isMultiple = true
      if (dataSourceType === DataSourceType.NOTION && notionPages.length > 1)
        isMultiple = true
      if (dataSourceType === DataSourceType.WEB && websitePages.length > 1)
        isMultiple = true

      if (isMultiple) {
        showPlanUpgradeModal()
        return
      }
    }
    doOnStepChange()
  }, [dataSourceType, doOnStepChange, files.length, notSupportBatchUpload, notionPages.length, showPlanUpgradeModal, websitePages.length])

  // Check if Notion is authorized
  const isNotionAuthed = useMemo(() => {
    if (!authedDataSourceList)
      return false
    const notionSource = authedDataSourceList.find(item => item.provider === 'notion_datasource')
    if (!notionSource)
      return false
    return notionSource.credentials_list.length > 0
  }, [authedDataSourceList])

  const notionCredentialList = useMemo(() => {
    return authedDataSourceList.find(item => item.provider === 'notion_datasource')?.credentials_list || []
  }, [authedDataSourceList])

  // Render data source content based on type
  const renderDataSourceContent = () => {
    switch (dataSourceType) {
      case DataSourceType.FILE:
        return (
          <FileSource
            files={files}
            updateFileList={updateFileList}
            updateFile={updateFile}
            onPreview={updateCurrentFile}
            isShowVectorSpaceFull={isShowVectorSpaceFull}
            onStepChange={onStepChange}
            shouldShowDataSourceTypeList={shouldShowDataSourceTypeList}
            supportBatchUpload={supportBatchUpload}
            enableBilling={enableBilling}
            isSandboxPlan={plan.type === Plan.sandbox}
          />
        )
      case DataSourceType.NOTION:
        return (
          <NotionSource
            datasetId={datasetId}
            notionPages={notionPages}
            notionCredentialId={notionCredentialId}
            updateNotionPages={updateNotionPages}
            updateNotionCredentialId={updateNotionCredentialId}
            onPreview={updateCurrentPage}
            onSetting={onSetting}
            isShowVectorSpaceFull={isShowVectorSpaceFull}
            onStepChange={onStepChange}
            isNotionAuthed={isNotionAuthed}
            notionCredentialList={notionCredentialList}
          />
        )
      case DataSourceType.WEB:
        return (
          <WebSource
            shouldShowDataSourceTypeList={shouldShowDataSourceTypeList}
            websitePages={websitePages}
            updateWebsitePages={updateWebsitePages}
            onPreview={updateWebsite}
            onWebsiteCrawlProviderChange={onWebsiteCrawlProviderChange}
            onWebsiteCrawlJobIdChange={onWebsiteCrawlJobIdChange}
            crawlOptions={crawlOptions}
            onCrawlOptionsChange={onCrawlOptionsChange}
            authedDataSourceList={authedDataSourceList}
            isShowVectorSpaceFull={isShowVectorSpaceFull}
            onStepChange={onStepChange}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="h-full w-full overflow-x-auto">
      <div className="flex h-full w-full min-w-[1440px]">
        {/* Left panel - Data source selection */}
        <div className="relative h-full w-1/2 overflow-y-auto">
          <div className="flex justify-end">
            <div className={cn(s.form)}>
              {shouldShowDataSourceTypeList && dataSourceType && (
                <>
                  <div className={cn(s.stepHeader, 'system-md-semibold text-text-secondary')}>
                    {t('datasetCreation.steps.one')}
                  </div>
                  <DataSourceSelector
                    dataSourceType={dataSourceType}
                    dataSourceTypeDisable={dataSourceTypeDisable}
                    changeType={changeType}
                    onHideFilePreview={hideFilePreview}
                    onHideNotionPreview={hideNotionPagePreview}
                    onHideWebsitePreview={hideWebsitePreview}
                  />
                </>
              )}

              {renderDataSourceContent()}

              {/* Empty dataset creation link */}
              {!datasetId && (
                <>
                  <div className="my-8 h-px max-w-[640px] bg-divider-regular" />
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

        {/* Right panel - Preview */}
        <div className="h-full w-1/2 overflow-y-auto">
          {currentFile && <FilePreview file={currentFile} hidePreview={hideFilePreview} />}
          {currentNotionPage && (
            <NotionPagePreview
              currentPage={currentNotionPage}
              hidePreview={hideNotionPagePreview}
              notionCredentialId={notionCredentialId}
            />
          )}
          {currentWebsite && <WebsitePreview payload={currentWebsite} hidePreview={hideWebsitePreview} />}
          {isShowPlanUpgradeModal && (
            <PlanUpgradeModal
              show
              onClose={hidePlanUpgradeModal}
              title={t('billing.upgrade.uploadMultiplePages.title')!}
              description={t('billing.upgrade.uploadMultiplePages.description')!}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default StepOne
