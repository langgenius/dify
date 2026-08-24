import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
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
  const [isMoreOperationsOpen, setIsMoreOperationsOpen] = React.useState(false)

  return (
    <div
      className={cn(
        'absolute bottom-0 left-0 z-10 w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8',
        isMoreOperationsOpen ? 'flex' : 'hidden group-hover:flex',
      )}
    >
      <Button variant="primary" onClick={onApplyTemplate} className="grow">
        <span aria-hidden className="i-ri-add-line size-4" />
        <span>{t(($) => $['operations.choose'], { ns: 'datasetPipeline' })}</span>
      </Button>
      <Button variant="secondary" onClick={handleShowTemplateDetails} className="grow">
        <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
        <span>{t(($) => $['operations.details'], { ns: 'datasetPipeline' })}</span>
      </Button>
      {showMoreOperations && (
        <DropdownMenu open={isMoreOperationsOpen} onOpenChange={setIsMoreOperationsOpen}>
          <DropdownMenuTrigger
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3',
              'data-popup-open:bg-state-base-hover',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuPositioner placement="bottom-end" sideOffset={4}>
              <DropdownMenuPopup className="min-w-[160px]">
                <Operations
                  openEditModal={openEditModal}
                  onExport={handleExportDSL}
                  onDelete={handleDelete}
                  onClose={() => setIsMoreOperationsOpen(false)}
                />
              </DropdownMenuPopup>
            </DropdownMenuPositioner>
          </DropdownMenuPortal>
        </DropdownMenu>
      )}
    </div>
  )
}

export default React.memo(Actions)
