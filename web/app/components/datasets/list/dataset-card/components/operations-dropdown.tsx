import type { DatasetCardItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { useKnowledgeUpgrade } from '@/features/new-rag/upgrade/knowledge-upgrade-context-value'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getDatasetACLCapabilities } from '@/utils/permission'
import Operations from '../operations'

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
        'absolute top-2 right-2 z-5',
        open
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100',
      )}
    >
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          ref={triggerRef}
          className={cn(
            'inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] border-[0.5px]',
            'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg inset-ring-2 shadow-shadow-shadow-5 inset-ring-components-button-secondary-bg',
            'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
            'focus-visible:bg-state-base-hover focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-hover focus-visible:outline-hidden',
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
          <Operations
            showEdit={datasetACLCapabilities.canEdit}
            showDelete={datasetACLCapabilities.canDelete}
            showExportPipeline={
              dataset.runtime_mode === 'rag_pipeline' && datasetACLCapabilities.canImportExportDSL
            }
            showAccessConfig={datasetACLCapabilities.canAccessConfig}
            showUpgrade={canUpgrade}
            openRenameModal={openRenameModal}
            handleExportPipeline={handleExportPipeline}
            detectIsUsedByApp={detectIsUsedByApp}
            openAccessConfig={openAccessConfig}
            onUpgrade={() => knowledgeUpgrade.requestUpgrade(dataset, triggerRef)}
            onClose={() => setOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(OperationsDropdown)
