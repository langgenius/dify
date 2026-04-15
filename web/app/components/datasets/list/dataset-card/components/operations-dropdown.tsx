import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import Operations from '../operations'

type OperationsDropdownProps = {
  dataset: DataSet
  isCurrentWorkspaceDatasetOperator: boolean
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  detectIsUsedByApp: () => void
}

const OperationsDropdown = ({
  dataset,
  isCurrentWorkspaceDatasetOperator,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
}: OperationsDropdownProps) => {
  const [open, setOpen] = React.useState(false)

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
            'border-components-actionbar-border bg-components-button-secondary-bg p-0 shadow-lg ring-2 shadow-shadow-shadow-5 ring-components-button-secondary-bg ring-inset',
            'transition-colors hover:border-components-actionbar-border hover:bg-state-base-hover',
            'focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden focus-visible:ring-inset',
            open && 'bg-state-base-hover',
          )}
          aria-label="Dataset operations"
        >
          <span className="i-ri-more-fill h-5 w-5 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          popupClassName="min-w-[186px]"
        >
          <Operations
            showDelete={!isCurrentWorkspaceDatasetOperator}
            showExportPipeline={dataset.runtime_mode === 'rag_pipeline'}
            openRenameModal={openRenameModal}
            handleExportPipeline={handleExportPipeline}
            detectIsUsedByApp={detectIsUsedByApp}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(OperationsDropdown)
