import type { PopoverRootActions } from '@base-ui/react/popover'
import type { DataSet } from '@/models/datasets'
import * as React from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/base/ui/popover'
import { cn } from '@/utils/classnames'
import Operations from '../operations'

type OperationsPopoverProps = {
  dataset: DataSet
  isCurrentWorkspaceDatasetOperator: boolean
  actionsRef: React.RefObject<PopoverRootActions | null>
  openRenameModal: () => void
  handleExportPipeline: (include?: boolean) => void
  detectIsUsedByApp: () => void
}

const OperationsPopover = ({
  dataset,
  isCurrentWorkspaceDatasetOperator,
  actionsRef,
  openRenameModal,
  handleExportPipeline,
  detectIsUsedByApp,
}: OperationsPopoverProps) => {
  const containerRef = React.useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      className="absolute top-2 right-2 z-5 hidden group-hover:block"
      onClick={e => e.stopPropagation()}
    >
      <Popover actionsRef={actionsRef}>
        <PopoverTrigger
          className={cn(
            'group/btn inline-flex size-9 cursor-pointer items-center justify-center radius-lg border-[0.5px]',
            'border-components-actionbar-border bg-components-actionbar-bg p-0 shadow-lg ring-2 shadow-shadow-shadow-5 ring-components-actionbar-bg ring-inset',
            'hover:border-components-actionbar-border hover:bg-state-base-hover hover:backdrop-blur-[5px]',
            'data-popup-open:border-components-actionbar-border data-popup-open:bg-state-base-hover data-popup-open:backdrop-blur-[5px]',
          )}
        >
          <div className="flex size-8 items-center justify-center radius-lg hover:bg-state-base-hover">
            <span className="i-ri-more-fill h-5 w-5 text-text-tertiary" />
          </div>
        </PopoverTrigger>
        <PopoverContent
          placement="bottom-end"
          container={containerRef}
          className="min-w-[186px]"
          popupClassName="rounded-xl bg-none shadow-none ring-0 min-w-[186px]"
        >
          <Operations
            showDelete={!isCurrentWorkspaceDatasetOperator}
            showExportPipeline={dataset.runtime_mode === 'rag_pipeline'}
            openRenameModal={openRenameModal}
            handleExportPipeline={handleExportPipeline}
            detectIsUsedByApp={detectIsUsedByApp}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default React.memo(OperationsPopover)
