import type { DataSet } from '@/models/datasets'
import { RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import CustomPopover from '@/app/components/base/popover'
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
}: OperationsPopoverProps) => (
  <div className="absolute right-2 top-2 z-[15] hidden group-hover:block">
    <CustomPopover
      htmlContent={(
        <Operations
          showDelete={!isCurrentWorkspaceDatasetOperator}
          showExportPipeline={dataset.runtime_mode === 'rag_pipeline'}
          openRenameModal={openRenameModal}
          handleExportPipeline={handleExportPipeline}
          detectIsUsedByApp={detectIsUsedByApp}
        />
      )}
      className="z-20 min-w-[186px]"
      popupClassName="rounded-xl bg-none shadow-none ring-0 min-w-[186px]"
      position="br"
      trigger="click"
      btnElement={(
        <div className="flex size-8 items-center justify-center rounded-[10px] hover:bg-state-base-hover">
          <RiMoreFill className="h-5 w-5 text-text-tertiary" />
        </div>
      )}
      btnClassName={open =>
        cn(
          'size-9 cursor-pointer justify-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-0 shadow-lg shadow-shadow-shadow-5 ring-[2px] ring-inset ring-components-actionbar-bg hover:border-components-actionbar-border',
          open ? 'border-components-actionbar-border bg-state-base-hover' : '',
        )}
    />
  </div>
)

export default React.memo(OperationsPopover)
