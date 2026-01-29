'use client'

import { useBoolean, useDebounceFn } from 'ahooks'
import { useRouter } from 'next/navigation'
// Libraries
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import Button from '@/app/components/base/button'
import { ApiConnectionMod } from '@/app/components/base/icons/src/vender/solid/development'
import Input from '@/app/components/base/input'
import TagManagementModal from '@/app/components/base/tag-management'
import TagFilter from '@/app/components/base/tag-management/filter'
// Hooks
import { useStore as useTagStore } from '@/app/components/base/tag-management/store'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { useAppContext, useSelector as useAppContextSelector } from '@/context/app-context'
import { useExternalApiPanel } from '@/context/external-api-panel-context'
import { useGlobalPublicStore } from '@/context/global-public-context'
import useDocumentTitle from '@/hooks/use-document-title'
import { useDatasetApiBaseUrl } from '@/service/knowledge/use-dataset'
// Components
import ExternalAPIPanel from '../external-api/external-api-panel'
import ServiceApi from '../extra-info/service-api'
import DatasetFooter from './dataset-footer'
import Datasets from './datasets'

const List = () => {
  const { t } = useTranslation()
  const { systemFeatures } = useGlobalPublicStore()
  const router = useRouter()
  const { currentWorkspace, isCurrentWorkspaceOwner } = useAppContext()
  const showTagManagementModal = useTagStore(s => s.showTagManagementModal)
  const { showExternalApiPanel, setShowExternalApiPanel } = useExternalApiPanel()
  const [includeAll, { toggle: toggleIncludeAll }] = useBoolean(false)
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

  useEffect(() => {
    if (currentWorkspace.role === 'normal')
      return router.replace('/apps')
  }, [currentWorkspace, router])

  const isCurrentWorkspaceManager = useAppContextSelector(state => state.isCurrentWorkspaceManager)
  const { data: apiBaseInfo } = useDatasetApiBaseUrl()

  return (
    <div className="scroll-container relative flex grow flex-col overflow-y-auto bg-background-body">
      <div className="sticky top-0 z-10 flex items-center justify-end gap-x-1 bg-background-body px-12 pb-2 pt-4">
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
          <TagFilter type="knowledge" value={tagFilterValue} onChange={handleTagsChange} />
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
          <div className="h-4 w-[1px] bg-divider-regular" />
          <Button
            className="shadows-shadow-xs gap-0.5"
            onClick={() => setShowExternalApiPanel(true)}
          >
            <ApiConnectionMod className="h-4 w-4 text-components-button-secondary-text" />
            <div className="system-sm-medium flex items-center justify-center gap-1 px-0.5 text-components-button-secondary-text">{t('externalAPIPanelTitle', { ns: 'dataset' })}</div>
          </Button>
        </div>
      </div>
      <Datasets tags={tagIDs} keywords={searchKeywords} includeAll={includeAll} />
      {!systemFeatures.branding.enabled && <DatasetFooter />}
      {showTagManagementModal && (
        <TagManagementModal type="knowledge" show={showTagManagementModal} />
      )}
      {showExternalApiPanel && <ExternalAPIPanel onClose={() => setShowExternalApiPanel(false)} />}
    </div>
  )
}

export default List
