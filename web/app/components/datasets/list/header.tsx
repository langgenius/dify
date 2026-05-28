'use client'

import { Button } from '@langgenius/dify-ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import ServiceApi from '../extra-info/service-api'
import DatasetListPageTitle from './page-title'

type Props = {
  apiBaseUrl: string
  includeAll: boolean
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceManager: boolean
  isCurrentWorkspaceOwner: boolean
  keywords: string
  tagFilterValue: string[]
  onCreateDataset: () => void
  onCreateFromPipeline: () => void
  onConnectDataset: () => void
  onExternalApiClick: () => void
  onIncludeAllChange: () => void
  onKeywordsChange: (value: string) => void
  onOpenTagManagement: () => void
  onTagsChange: (value: string[]) => void
}

const DatasetListHeader = ({
  apiBaseUrl,
  includeAll,
  isCurrentWorkspaceEditor,
  isCurrentWorkspaceManager,
  isCurrentWorkspaceOwner,
  keywords,
  tagFilterValue,
  onCreateDataset,
  onCreateFromPipeline,
  onConnectDataset,
  onExternalApiClick,
  onIncludeAllChange,
  onKeywordsChange,
  onOpenTagManagement,
  onTagsChange,
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className="sticky top-0 z-10 flex flex-col bg-background-body px-6 pt-2 pb-2">
      <div className="flex items-start justify-between gap-4 pt-2">
        <DatasetListPageTitle
          title={t('knowledge', { ns: 'dataset' })}
          description={t('studioDescription', { ns: 'dataset' })}
        />
        <div className="flex h-[42px] shrink-0 items-end">
          <Button
            className="gap-0.5 shadow-xs"
            onClick={onExternalApiClick}
          >
            <span className="i-custom-vender-solid-development-api-connection-mod h-4 w-4 text-components-button-secondary-text" />
            <span className="flex items-center justify-center gap-1 px-0.5 system-sm-medium text-components-button-secondary-text">{t('externalAPIPanelTitle', { ns: 'dataset' })}</span>
          </Button>
        </div>
      </div>
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {isCurrentWorkspaceOwner && (
            <CheckboxWithLabel
              isChecked={includeAll}
              onChange={onIncludeAllChange}
              label={t('allKnowledge', { ns: 'dataset' })}
              labelClassName="system-md-regular text-text-tertiary"
              className="h-8"
              tooltip={t('allKnowledgeDescription', { ns: 'dataset' }) as string}
            />
          )}
          <TagFilter type="knowledge" value={tagFilterValue} onChange={onTagsChange} onOpenTagManagement={onOpenTagManagement} />
          <SearchInput
            className="w-[200px]"
            value={keywords}
            onChange={onKeywordsChange}
          />
        </div>
        <div className="flex items-center gap-2">
          {
            isCurrentWorkspaceManager && (
              <ServiceApi apiBaseUrl={apiBaseUrl} />
            )
          }
          {isCurrentWorkspaceEditor && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={(
                  <Button
                    variant="primary"
                    size="medium"
                    className="gap-0.5 px-2 shadow-xs"
                  >
                    <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                    <span className="pl-1">{t('operation.create', { ns: 'common' })}</span>
                    <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
                  </Button>
                )}
              />
              <DropdownMenuContent
                placement="bottom-end"
                sideOffset={4}
                popupClassName="w-80 p-1"
              >
                <DropdownMenuItem
                  className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                  onClick={onCreateDataset}
                >
                  <span aria-hidden className="i-ri-add-line size-4 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate px-1">{t('createDataset', { ns: 'dataset' })}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                  onClick={onCreateFromPipeline}
                >
                  <span aria-hidden className="i-ri-function-add-line size-4 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate px-1">{t('createFromPipeline', { ns: 'dataset' })}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                  onClick={onConnectDataset}
                >
                  <span aria-hidden className="i-custom-vender-solid-development-api-connection-mod size-4 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1 truncate px-1">{t('connectDataset', { ns: 'dataset' })}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}

export default DatasetListHeader
