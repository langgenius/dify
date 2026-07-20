'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import ServiceApi from '../extra-info/service-api'

type Props = {
  apiBaseUrl: string
  canConnectExternalDataset: boolean
  canCreateDataset: boolean
  includeAll: boolean
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
  canConnectExternalDataset,
  canCreateDataset,
  includeAll,
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
  const showCreateMenu = canCreateDataset || canConnectExternalDataset

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-[14px] bg-background-body px-8 pt-4 pb-2">
      <div className="flex h-6 w-full items-center gap-2">
        <h1 className="min-w-0 flex-1 text-[18px]/[21.6px] font-semibold text-text-primary">
          {t(($) => $.knowledge, { ns: 'dataset' })}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {canConnectExternalDataset && (
            <button
              type="button"
              className="flex h-6 items-center justify-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-text-tertiary hover:bg-state-base-hover"
              onClick={onExternalApiClick}
            >
              <span
                aria-hidden
                className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
              />
              <span className="px-0.5 system-xs-medium">
                {t(($) => $.externalAPIPanelTitle, { ns: 'dataset' })}
              </span>
            </button>
          )}
          <ServiceApi apiBaseUrl={apiBaseUrl} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <TagFilter
            type="knowledge"
            value={tagFilterValue}
            onChange={onTagsChange}
            onOpenTagManagement={onOpenTagManagement}
            showLeadingIcon={false}
          />
          <SearchInput className="w-[200px]" value={keywords} onValueChange={onKeywordsChange} />
          {isCurrentWorkspaceOwner && (
            <>
              <div className="h-3.5 w-px bg-divider-regular" />
              <CheckboxWithLabel
                isChecked={includeAll}
                onChange={onIncludeAllChange}
                label={t(($) => $.allKnowledge, { ns: 'dataset' })}
                labelClassName="system-md-regular text-text-tertiary"
                className="h-8"
                tooltip={t(($) => $.allKnowledgeDescription, { ns: 'dataset' }) as string}
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showCreateMenu && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button variant="primary" size="medium" className="gap-0.5 px-2 shadow-xs">
                    <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                    <span className="pl-1">
                      {t(($) => $['operation.create'], { ns: 'common' })}
                    </span>
                    <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
                  </Button>
                }
              />
              <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-80">
                {canCreateDataset && (
                  <>
                    <DropdownMenuItem
                      className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                      onClick={onCreateDataset}
                    >
                      <span
                        aria-hidden
                        className="i-ri-add-line size-4 shrink-0 text-text-secondary"
                      />
                      <span className="min-w-0 flex-1 truncate px-1">
                        {t(($) => $['firstEmpty.createTitle'], { ns: 'dataset' })}
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                      onClick={onCreateFromPipeline}
                    >
                      <span
                        aria-hidden
                        className="i-custom-vender-pipeline-pipeline-line size-4 shrink-0 text-text-secondary"
                      />
                      <span className="min-w-0 flex-1 truncate px-1">
                        {t(($) => $['firstEmpty.pipelineTitle'], { ns: 'dataset' })}
                      </span>
                    </DropdownMenuItem>
                  </>
                )}
                {canCreateDataset && canConnectExternalDataset && (
                  <DropdownMenuSeparator className="my-1" />
                )}
                {canConnectExternalDataset && (
                  <DropdownMenuItem
                    className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
                    onClick={onConnectDataset}
                  >
                    <span
                      aria-hidden
                      className="i-custom-vender-solid-development-api-connection-mod size-4 shrink-0 text-text-secondary"
                    />
                    <span className="min-w-0 flex-1 truncate px-1">
                      {t(($) => $.connectDataset, { ns: 'dataset' })}
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </div>
  )
}

export default DatasetListHeader
