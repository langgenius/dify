import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import {
  datasetRbacEnabledAtom,
  userProfileIdAtom,
  workspacePermissionKeysAtom,
} from '@/context/app-context-state'
import { getDatasetACLCapabilities } from '@/utils/permission'
import Operations from '../operations'

type OperationsDropdownProps = {
  dataset: DataSet
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  detectIsUsedByApp: () => void
  openAccessConfig: () => void
}

const OperationsDropdown = ({
  dataset,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
  openAccessConfig,
}: OperationsDropdownProps) => {
  const [open, setOpen] = React.useState(false)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = useAtomValue(datasetRbacEnabledAtom)
  const datasetACLCapabilities = React.useMemo(() => getDatasetACLCapabilities(dataset.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  }), [dataset.maintainer, dataset.permission_keys, currentUserId, isRbacEnabled, workspacePermissionKeys])
  const canShowOperations = datasetACLCapabilities.canEdit
    || datasetACLCapabilities.canImportExportDSL
    || datasetACLCapabilities.canAccessConfig
    || datasetACLCapabilities.canDelete

  if (!canShowOperations)
    return null

  return (
    <div
      className={cn(
        'absolute top-2 right-2 z-5',
        open
          ? 'pointer-events-auto visible'
          : 'pointer-events-none invisible group-hover:pointer-events-auto group-hover:visible',
      )}
      onClick={e => e.stopPropagation()}
    >
      <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] border-[0.5px]',
            'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg inset-ring-2 shadow-shadow-shadow-5 inset-ring-components-button-secondary-bg',
            'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
            'focus-visible:bg-state-base-hover focus-visible:inset-ring-1 focus-visible:inset-ring-components-input-border-hover focus-visible:outline-hidden',
            'data-popup-open:bg-state-base-hover',
          )}
          aria-label="Dataset operations"
        >
          <span className="i-ri-more-fill size-5 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          popupClassName="min-w-[186px]"
        >
          <Operations
            showEdit={datasetACLCapabilities.canEdit}
            showDelete={datasetACLCapabilities.canDelete}
            showExportPipeline={dataset.runtime_mode === 'rag_pipeline' && datasetACLCapabilities.canImportExportDSL}
            showAccessConfig={datasetACLCapabilities.canAccessConfig}
            openRenameModal={openRenameModal}
            handleExportPipeline={handleExportPipeline}
            detectIsUsedByApp={detectIsUsedByApp}
            openAccessConfig={openAccessConfig}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(OperationsDropdown)
