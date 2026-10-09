import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  onApplyTemplate: () => void
  showMoreOperations: boolean
  openEditModal: () => void
  handleExportDSL: (includeSecret?: boolean) => void
  handleDelete: () => void
}

const Actions = ({
  onApplyTemplate,
  showMoreOperations,
  openEditModal,
  handleExportDSL,
  handleDelete,
}: ActionsProps) => {
  const { t } = useTranslation(['common', 'datasetPipeline'])

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 z-10 flex w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100">
      <Button variant="primary" onClick={onApplyTemplate} className="grow">
        <span aria-hidden className="i-ri-add-line size-4" />
        <span>{t(($) => $['operations.choose'], { ns: 'datasetPipeline' })}</span>
      </Button>
      <DialogTrigger
        render={
          <Button variant="secondary" className="grow">
            <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
            <span>{t(($) => $['operations.details'], { ns: 'datasetPipeline' })}</span>
          </Button>
        }
      />
      {showMoreOperations && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3',
              'outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-40">
            <DropdownMenuItem
              onClick={() => {
                openEditModal()
              }}
            >
              {t(($) => $['operations.editInfo'], { ns: 'datasetPipeline' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                handleExportDSL()
              }}
            >
              {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                handleDelete()
              }}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export default React.memo(Actions)
