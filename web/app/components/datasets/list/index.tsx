'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean, useDebounceFn } from 'ahooks'

// Libraries
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { TagManagementModal } from '@/features/tag-management/components/tag-management-modal'
import useDocumentTitle from '@/hooks/use-document-title'
import { useDatasetApiBaseUrl, useInvalidDatasetList } from '@/service/knowledge/use-dataset'
import { systemFeaturesQueryOptions } from '@/service/system-features'
// Components
import ExternalAPIPanel from '../external-api/external-api-panel'
import ServiceApi from '../extra-info/service-api'
import DatasetFooter from './dataset-footer'
import Datasets from './datasets'

const List = () => {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { isCurrentWorkspaceOwner } = useAppContext()
  const [showTagManagementModal, setShowTagManagementModal] = useState(false)
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const [includeAll, { toggle: toggleIncludeAll }] = useBoolean(false)
  const invalidDatasetList = useInvalidDatasetList()
  useDocumentTitle(t('knowledge', { ns: 'dataset' }))

  const [keywords, setKeywords] = useState('')
  const [searchKeywords, setSearchKeywords] = useState('')
  const { run: handleSearch } = useDebounceFn(() => {
    setSearchKeywords(keywords)
  }, { wait: 500 })
  const handleKeywordsChange = (value: string) => {
    setKeywords(value)
    handleSearch()
  }
  const [tagFilterValue, setTagFilterValue] = useState<string[]>([])
  const [tagIDs, setTagIDs] = useState<string[]>([])
  const { run: handleTagsUpdate } = useDebounceFn(() => {
    setTagIDs(tagFilterValue)
  }, { wait: 500 })
  const handleTagsChange = (value: string[]) => {
    setTagFilterValue(value)
    handleTagsUpdate()
  }

  const isCurrentWorkspaceManager = useAppContextSelector(state => state.isCurrentWorkspaceManager)
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()

  return (
    <div className="relative flex grow flex-col overflow-y-auto bg-background-body">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-x-1 bg-background-body px-12 pt-4 pb-2">
        <div className="flex items-center justify-center gap-2">
          {isCurrentWorkspaceOwner && (
            <CheckboxWithLabel
              isChecked={includeAll}
              onChange={toggleIncludeAll}
              label={t('allKnowledge', { ns: 'dataset' })}
              labelClassName="system-md-regular text-text-secondary"
              className="mr-2"
              tooltip={t('allKnowledgeDescription', { ns: 'dataset' }) as string}
            />
          )}
          <TagFilter type="knowledge" value={tagFilterValue} onChange={handleTagsChange} onOpenTagManagement={() => setShowTagManagementModal(true)} />
          <Input
            showLeftIcon
            showClearIcon
            wrapperClassName="w-[200px]"
            value={keywords}
            onChange={e => handleKeywordsChange(e.target.value)}
            onClear={() => handleKeywordsChange('')}
          />
          {
            isCurrentWorkspaceManager && (
              <ServiceApi apiBaseUrl={apiBaseInfo?.api_base_url ?? ''} />
            )
          }
          <div className="h-4 w-px bg-divider-regular" />
          <Button
            className="gap-0.5 shadow-xs"
            onClick={() => setShowExternalApiPanel(true)}
          >
            <span className="i-custom-vender-solid-development-api-connection-mod h-4 w-4 text-components-button-secondary-text" />
            <span className="flex items-center justify-center gap-1 px-0.5 system-sm-medium text-components-button-secondary-text">{t('externalAPIPanelTitle', { ns: 'dataset' })}</span>
          </Button>
        </div>
      </div>
      <Datasets tags={tagIDs} keywords={searchKeywords} includeAll={includeAll} onOpenTagManagement={() => setShowTagManagementModal(true)} />
      {!systemFeatures.branding.enabled && <DatasetFooter />}
      <TagManagementModal
        type="knowledge"
        show={showTagManagementModal}
        onClose={() => setShowTagManagementModal(false)}
        onTagsChange={invalidDatasetList}
      />
      {showExternalApiPanel && <ExternalAPIPanel onClose={() => setShowExternalApiPanel(false)} />}
    </div>
  )
}

export default List
