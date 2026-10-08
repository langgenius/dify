import type { DatasetCardItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuArrow,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useKnowledgeUpgrade } from '@/features/new-rag/upgrade/knowledge-upgrade-context-value'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getDatasetACLCapabilities } from '@/utils/permission'

type OperationsDropdownProps = {
  dataset: DatasetCardItem
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  detectIsUsedByApp: () => void
  openAccessConfig: () => void
  stepByStepTourHighlightPart?: string
  stepByStepTourOpen?: boolean
}

const OperationsDropdown = ({
  dataset,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  openAccessConfig,
  stepByStepTourHighlightPart,
  stepByStepTourOpen,
}: OperationsDropdownProps) => {
  const operationsMenu = useStepByStepTourControlledDropdown({
    allowTriggerCloseWhileControlled: false,
    controlledOpen: stepByStepTourOpen,
  })
  const open = operationsMenu.open
  const setOpen = operationsMenu.onOpenChange
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const { t } = useTranslation([
    'common',
    'datasetPipeline',
    'knowledgeSpace',
    'navigation',
    'knowledgeUpgrade',
  ])
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const knowledgeUpgrade = useKnowledgeUpgrade()
  const { data: isRbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ rbac_enabled }) => rbac_enabled,
  })
  const datasetACLCapabilities = React.useMemo(
    () =>
      getDatasetACLCapabilities(dataset.permission_keys, {
        currentUserId,
        resourceMaintainer: dataset.maintainer ?? undefined,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
    [
      dataset.maintainer,
      dataset.permission_keys,
      currentUserId,
      isRbacEnabled,
      workspacePermissionKeys,
    ],
  )
  const canUpgrade =
    knowledgeUpgrade.enabled &&
    datasetACLCapabilities.canEdit &&
    dataset.knowledge_fs_upgrade?.can_upgrade === true
  const canShowOperations =
    datasetACLCapabilities.canEdit ||
    datasetACLCapabilities.canImportExportDSL ||
    datasetACLCapabilities.canAccessConfig ||
    datasetACLCapabilities.canDelete

  if (!canShowOperations) return null

  return (
    <div
      className={cn(
        'absolute right-2 z-5',
        dataset.embedding_available ? 'top-2' : 'top-6',
        open
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          ref={triggerRef}
          className={cn(
            'inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] border-[0.5px]',
            'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg inset-ring-2 shadow-shadow-shadow-5 inset-ring-components-button-secondary-bg',
            'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
            'focus-visible:bg-state-base-hover',
            'data-popup-open:bg-state-base-hover',
          )}
          aria-label="Dataset operations"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <span className="i-ri-more-fill size-5 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          {...getStepByStepTourDropdownMenuContentProps({
            highlightPart: stepByStepTourHighlightPart,
            interactionMode: operationsMenu.controlled ? 'presentation' : 'interactive',
            className: 'min-w-44',
          })}
        >
          {canUpgrade && (
            <>
              <div role="presentation" className="flex">
                <DropdownMenuItem
                  className="mr-0 min-w-0 flex-1 gap-2 rounded-r-none text-text-accent"
                  onClick={() => knowledgeUpgrade.requestUpgrade(dataset, triggerRef)}
                >
                  <span aria-hidden className="i-ri-arrow-up-circle-line size-4" />
                  <span className="min-w-0 flex-1">
                    {t(($) => $['upgrade.menuLabel'], { ns: 'knowledgeUpgrade' })}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    aria-label={t(($) => $['upgrade.guideTitle'], { ns: 'knowledgeUpgrade' })}
                    className="ml-0 w-8 shrink-0 rounded-l-none px-2 text-text-quaternary [&>span:last-child]:hidden"
                  >
                    <span aria-hidden className="i-ri-question-line size-4" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    placement="right-start"
                    sideOffset={12}
                    className="w-80 max-w-[calc(100vw-2rem)] overflow-visible rounded-xl border border-divider-subtle bg-components-panel-bg p-0 shadow-md"
                  >
                    <DropdownMenuArrow />
                    <div role="presentation" className="px-4 pt-3.5">
                      <div className="system-md-medium text-text-primary">
                        {t(($) => $['upgrade.guideTitle'], { ns: 'knowledgeUpgrade' })}
                      </div>
                      <p className="mt-2 system-sm-regular text-text-secondary">
                        {t(($) => $['upgrade.guideDescription'], { ns: 'knowledgeUpgrade' })}
                      </p>
                    </div>
                    <DropdownMenuLinkItem
                      href="https://docs.dify.ai/en/guides/knowledge-base"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 mb-1 justify-end system-xs-medium text-text-accent"
                    >
                      {t(($) => $.learnMore, { ns: 'knowledgeSpace' })}
                    </DropdownMenuLinkItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </div>
              <DropdownMenuSeparator />
            </>
          )}
          {datasetACLCapabilities.canEdit && (
            <DropdownMenuItem className="gap-2" onClick={openRenameModal}>
              <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          {dataset.runtime_mode === 'rag_pipeline' && datasetACLCapabilities.canImportExportDSL && (
            <DropdownMenuItem className="gap-2" onClick={() => handleExportPipeline()}>
              <span aria-hidden className="i-ri-file-download-line size-4 text-text-tertiary" />
              {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
            </DropdownMenuItem>
          )}
          {datasetACLCapabilities.canAccessConfig && (
            <DropdownMenuItem className="gap-2" onClick={openAccessConfig}>
              <span aria-hidden className="i-ri-lock-line size-4 text-text-tertiary" />
              {t(($) => $['settings.resourceAccess'], { ns: 'navigation' })}
            </DropdownMenuItem>
          )}
          {datasetACLCapabilities.canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" variant="destructive" onClick={detectIsUsedByApp}>
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(OperationsDropdown)
