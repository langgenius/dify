import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
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
      <Button
        variant="primary"
        onClick={onApplyTemplate}
        className="grow gap-x-0.5"
      >
        <span aria-hidden className="i-ri-add-line size-4" />
        <span className="px-0.5">{t('operations.choose', { ns: 'datasetPipeline' })}</span>
      </Button>
      <Button
        variant="secondary"
        onClick={handleShowTemplateDetails}
        className="grow gap-x-0.5"
      >
        <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
        <span className="px-0.5">{t('operations.details', { ns: 'datasetPipeline' })}</span>
      </Button>
      {
        showMoreOperations && (
          <DropdownMenu open={isMoreOperationsOpen} onOpenChange={setIsMoreOperationsOpen}>
            <DropdownMenuTrigger
              aria-label={t('operation.more', { ns: 'common' })}
              className={cn(
                'flex size-8 cursor-pointer items-center justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3',
                isMoreOperationsOpen && 'bg-state-base-hover',
              )}
              onClick={e => e.stopPropagation()}
            >
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              placement="bottom-end"
              sideOffset={4}
              popupClassName="min-w-[160px] border-0 bg-transparent py-0 shadow-none backdrop-blur-none"
            >
              <Operations
                openEditModal={openEditModal}
                onExport={handleExportDSL}
                onDelete={handleDelete}
                onClose={() => setIsMoreOperationsOpen(false)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }
    </div>
  )
}

export default React.memo(Actions)
