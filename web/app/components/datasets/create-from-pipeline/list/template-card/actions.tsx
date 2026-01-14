import { RiAddLine, RiArrowRightUpLine, RiMoreFill } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import CustomPopover from '@/app/components/base/popover'
import Operations from './operations'

type ActionsProps = {
  onApplyTemplate: () => void
  handleShowTemplateDetails: () => void
  showMoreOperations: boolean
  openEditModal: () => void
  handleExportDSL: (includeSecret?: boolean) => void
  handleDelete: () => void
}

const Actions = ({
  onApplyTemplate,
  handleShowTemplateDetails,
  showMoreOperations,
  openEditModal,
  handleExportDSL,
  handleDelete,
}: ActionsProps) => {
  const { t } = useTranslation()

  return (
    <div className="absolute bottom-0 left-0 z-10 hidden w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8 group-hover:flex">
      <Button
        variant="primary"
        onClick={onApplyTemplate}
        className="grow gap-x-0.5"
      >
        <RiAddLine className="size-4" />
        <span className="px-0.5">{t('operations.choose', { ns: 'datasetPipeline' })}</span>
      </Button>
      <Button
        variant="secondary"
        onClick={handleShowTemplateDetails}
        className="grow gap-x-0.5"
      >
        <RiArrowRightUpLine className="size-4" />
        <span className="px-0.5">{t('operations.details', { ns: 'datasetPipeline' })}</span>
      </Button>
      {
        showMoreOperations && (
          <CustomPopover
            htmlContent={(
              <Operations
                openEditModal={openEditModal}
                onExport={handleExportDSL}
                onDelete={handleDelete}
              />
            )}
            className="z-20 min-w-[160px]"
            popupClassName="rounded-xl bg-none shadow-none ring-0 min-w-[160px]"
            position="br"
            trigger="click"
            btnElement={
              <RiMoreFill className="size-4 text-text-tertiary" />
            }
            btnClassName="size-8 cursor-pointer justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3"
          />
        )
      }
    </div>
  )
}

export default React.memo(Actions)
