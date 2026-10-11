import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getDatasetACLCapabilities } from '@/utils/permission'

type OperationsDropdownProps = {
  dataset: DataSet
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
  const { t } = useTranslation(['common', 'datasetPipeline', 'navigation'])
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: isRbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ rbac_enabled }) => rbac_enabled,
  })
  const datasetACLCapabilities = React.useMemo(
    () =>
      getDatasetACLCapabilities(dataset.permission_keys, {
        currentUserId,
        resourceMaintainer: dataset.maintainer,
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
            className: 'min-w-[186px]',
          })}
        >
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
