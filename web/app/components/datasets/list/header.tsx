'use client'

import type { KnowledgeViewSwitcherProps } from '@/features/new-rag/list/knowledge-view-switcher'
import { Button } from '@langgenius/dify-ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import { SearchInput } from '@/app/components/base/search-input'
import CheckboxWithLabel from '@/app/components/datasets/create/website/base/checkbox-with-label'
import { CreatorFilter } from '@/app/components/datasets/creator-filter'
import {
  getStepByStepTourMenuContentProps,
  useStepByStepTourControlledMenu,
} from '@/app/components/step-by-step-tour/menu'
import { KnowledgeViewSwitcher } from '@/features/new-rag/list/knowledge-view-switcher'
import { TagFilter } from '@/features/tag-management/components/tag-filter'
import { ServiceApi } from '../extra-info/service-api'

type Props = {
  apiBaseUrl: string
  canConnectExternalDataset: boolean
  canCreateDataset: boolean
  creatorFilterValue: string[]
  includeAll: boolean
  isCurrentWorkspaceOwner: boolean
  keywords: string
  tagFilterValue: string[]
  onCreateDataset: () => void
  onCreateFromPipeline: () => void
  onConnectDataset: () => void
  onExternalApiClick: () => void
  onCreatorsChange: (value: string[]) => void
  onIncludeAllChange: () => void
  onKeywordsChange: (value: string) => void
  onOpenTagManagement: () => void
  onTagsChange: (value: string[]) => void
  stepByStepTourCreateMenuHighlightPart?: string
  stepByStepTourCreateMenuOpen?: boolean
  stepByStepTourCreateMenuTarget?: string
  knowledgeViewSwitcherProps?: KnowledgeViewSwitcherProps
}

const DatasetListHeader = ({
  apiBaseUrl,
  canConnectExternalDataset,
  canCreateDataset,
  creatorFilterValue,
  includeAll,
  isCurrentWorkspaceOwner,
  keywords,
  tagFilterValue,
  onCreateDataset,
  onCreateFromPipeline,
  onConnectDataset,
  onExternalApiClick,
  onCreatorsChange,
  onIncludeAllChange,
  onKeywordsChange,
  onOpenTagManagement,
  onTagsChange,
  stepByStepTourCreateMenuHighlightPart,
  stepByStepTourCreateMenuOpen,
  stepByStepTourCreateMenuTarget,
  knowledgeViewSwitcherProps,
}: Props) => {
  const { t } = useTranslation(['common', 'dataset'])
  const showCreateMenu = canCreateDataset || canConnectExternalDataset
  const createMenu = useStepByStepTourControlledMenu({
    controlledOpen: stepByStepTourCreateMenuOpen,
  })

  return (
    <div className="sticky top-0 z-10 flex flex-col gap-3.5 bg-background-body px-8 pt-4 pb-2">
      <div className="flex min-h-6 w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-[18px]/[21.6px] font-semibold text-text-primary">
            {t(($) => $.knowledge, { ns: 'dataset' })}
          </h1>
          {knowledgeViewSwitcherProps && <KnowledgeViewSwitcher {...knowledgeViewSwitcherProps} />}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {canConnectExternalDataset && (
            <Button
              variant="ghost"
              size="small"
              className="overflow-hidden text-text-tertiary"
              onClick={onExternalApiClick}
            >
              <span
                aria-hidden
                className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
              />
              <span className="system-xs-medium">
                {t(($) => $.externalAPIPanelTitle, { ns: 'dataset' })}
              </span>
            </Button>
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
            triggerClassName="min-w-0"
          />
          <CreatorFilter value={creatorFilterValue} onChange={onCreatorsChange} />
          <SearchInput
            className="w-full min-w-0 sm:w-50"
            value={keywords}
            onValueChange={onKeywordsChange}
          />
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
            <Menu modal={false} open={createMenu.open} onOpenChange={createMenu.onOpenChange}>
              <MenuTrigger
                render={
                  <Button
                    variant="primary"
                    size="medium"
                    className="px-2 shadow-xs"
                    data-step-by-step-tour-target={stepByStepTourCreateMenuTarget}
                  >
                    <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
                    <span>{t(($) => $['operation.create'], { ns: 'common' })}</span>
                    <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
                  </Button>
                }
              />
              <MenuContent
                align="end"
                {...getStepByStepTourMenuContentProps({
                  disableMotion: createMenu.controlled,
                  highlightPart: createMenu.controlled
                    ? stepByStepTourCreateMenuHighlightPart
                    : undefined,
                  interactionMode: createMenu.controlled ? 'presentation' : 'interactive',
                  className: 'w-80',
                })}
              >
                {canCreateDataset && (
                  <>
                    <MenuItem
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
                    </MenuItem>
                    <MenuItem
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
                    </MenuItem>
                  </>
                )}
                {canCreateDataset && canConnectExternalDataset && (
                  <MenuSeparator className="my-1" />
                )}
                {canConnectExternalDataset && (
                  <MenuItem
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
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
      </div>
    </div>
  )
}

export default DatasetListHeader
