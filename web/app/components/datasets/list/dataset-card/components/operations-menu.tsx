import type { DatasetCardItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourMenuContentProps,
  useStepByStepTourControlledMenu,
} from '@/app/components/step-by-step-tour/menu'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useKnowledgeUpgrade } from '@/features/new-rag/upgrade/knowledge-upgrade-context-value'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getDatasetACLCapabilities } from '@/utils/permission'

type OperationsMenuProps = {
  dataset: DatasetCardItem
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  onDelete: () => void
  openAccessConfig: () => void
  stepByStepTourHighlightPart?: string
  stepByStepTourOpen?: boolean
}

const OperationsMenu = ({
  dataset,
  openRenameModal,
  handleExportPipeline,
  onDelete,
  openAccessConfig,
  stepByStepTourHighlightPart,
  stepByStepTourOpen,
}: OperationsMenuProps) => {
  const operationsMenu = useStepByStepTourControlledMenu({
    allowTriggerCloseWhileControlled: false,
    controlledOpen: stepByStepTourOpen,
  })
  const open = operationsMenu.open
  const setOpen = operationsMenu.onOpenChange
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const { t } = useTranslation(['common', 'datasetPipeline', 'navigation', 'knowledgeUpgrade'])
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
        'absolute inset-e-2 z-5',
        dataset.embedding_available ? 'top-2' : 'top-6',
        open
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100',
      )}
    >
      <Menu modal={false} open={open} onOpenChange={setOpen}>
        <MenuTrigger
          ref={triggerRef}
          className={cn(
            'inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] border-[0.5px]',
            'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg inset-ring-2 shadow-shadow-shadow-5 inset-ring-components-button-secondary-bg',
            'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
            'focus-visible:bg-state-base-hover',
            'data-popup-open:bg-state-base-hover',
          )}
          aria-label={t(($) => $['operation.more'], { ns: 'common' })}
        >
          <span aria-hidden className="i-ri-more-fill size-5 text-text-tertiary" />
        </MenuTrigger>
        <MenuContent
          align="end"
          {...getStepByStepTourMenuContentProps({
            highlightPart: stepByStepTourHighlightPart,
            interactionMode: operationsMenu.controlled ? 'presentation' : 'interactive',
            className: 'min-w-44',
          })}
        >
          {canUpgrade && (
            <>
              <MenuItem
                className="gap-2 text-text-accent"
                onClick={() => knowledgeUpgrade.requestUpgrade(dataset, triggerRef)}
              >
                <span aria-hidden className="i-ri-arrow-up-circle-line size-4" />
                {t(($) => $['upgrade.menuLabel'], { ns: 'knowledgeUpgrade' })}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {datasetACLCapabilities.canEdit && (
            <MenuItem className="gap-2" onClick={openRenameModal}>
              <span aria-hidden className="i-ri-edit-line size-4 text-text-tertiary" />
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </MenuItem>
          )}
          {dataset.runtime_mode === 'rag_pipeline' && datasetACLCapabilities.canImportExportDSL && (
            <MenuItem className="gap-2" onClick={() => handleExportPipeline()}>
              <span aria-hidden className="i-ri-file-download-line size-4 text-text-tertiary" />
              {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
            </MenuItem>
          )}
          {datasetACLCapabilities.canAccessConfig && (
            <MenuItem className="gap-2" onClick={openAccessConfig}>
              <span aria-hidden className="i-ri-lock-line size-4 text-text-tertiary" />
              {t(($) => $['settings.resourceAccess'], { ns: 'navigation' })}
            </MenuItem>
          )}
          {datasetACLCapabilities.canDelete && (
            <>
              <MenuSeparator />
              <MenuItem className="gap-2" variant="destructive" onClick={onDelete}>
                <span aria-hidden className="i-ri-delete-bin-line size-4" />
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
    </div>
  )
}

export default React.memo(OperationsMenu)
