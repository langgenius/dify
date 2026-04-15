import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { cn } from '@/utils/classnames'
import Operations from '../operations'

type OperationsPopoverProps = {
  dataset: DataSet
  isCurrentWorkspaceDatasetOperator: boolean
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  detectIsUsedByApp: () => void
}

const OperationsPopover = ({
  dataset,
  isCurrentWorkspaceDatasetOperator,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
}: OperationsPopoverProps) => {
  const [isOperationsMenuOpen, setIsOperationsMenuOpen] = React.useState(false)

  return (
    <div
      className={cn(
        'absolute right-2 top-2 z-15 transition-opacity',
        isOperationsMenuOpen
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100',
      )}
    >
      <DropdownMenu open={isOperationsMenuOpen} onOpenChange={setIsOperationsMenuOpen}>
        <DropdownMenuTrigger
          aria-label="more"
          className={cn(
            'inline-flex size-9 cursor-pointer items-center justify-center radius-lg border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0 shadow-lg shadow-shadow-shadow-5 ring-2 ring-inset ring-components-actionbar-bg hover:border-components-actionbar-border',
            isOperationsMenuOpen ? 'border-components-actionbar-border bg-state-base-hover' : '',
          )}
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}
        >
          <div className="flex size-8 items-center justify-center radius-lg hover:bg-state-base-hover">
            <span aria-hidden className="i-ri-more-fill h-5 w-5 text-text-tertiary" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[186px] border-0 bg-transparent py-0 shadow-none backdrop-blur-none"
        >
          <Operations
            showDelete={!isCurrentWorkspaceDatasetOperator}
            showExportPipeline={dataset.runtime_mode === 'rag_pipeline'}
            openRenameModal={openRenameModal}
            handleExportPipeline={handleExportPipeline}
            detectIsUsedByApp={detectIsUsedByApp}
            onClose={() => setIsOperationsMenuOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export default React.memo(OperationsPopover)
