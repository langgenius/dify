import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type ActionsProps = {
  onApplyTemplate: () => void
  openEditModal: () => void
  handleExportDSL: (includeSecret?: boolean) => void
  onDelete?: () => void
}

const Actions = ({ onApplyTemplate, openEditModal, handleExportDSL, onDelete }: ActionsProps) => {
  const { t } = useTranslation(['common', 'datasetPipeline'])

  return (
    <div className="pointer-events-none absolute inset-s-0 bottom-0 z-10 flex w-full items-center gap-x-1 bg-pipeline-template-card-hover-bg p-4 pt-8 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100">
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
      {onDelete && (
        <Menu>
          <MenuTrigger
            aria-label={t(($) => $['operation.more'], { ns: 'common' })}
            className={cn(
              'flex size-8 cursor-pointer items-center justify-center rounded-lg p-0 shadow-xs shadow-shadow-shadow-3',
              'data-popup-open:bg-state-base-hover',
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
          </MenuTrigger>
          <MenuContent align="end" className="min-w-40">
            <MenuItem
              onClick={() => {
                openEditModal()
              }}
            >
              {t(($) => $['operations.editInfo'], { ns: 'datasetPipeline' })}
            </MenuItem>
            <MenuItem
              onClick={() => {
                handleExportDSL()
              }}
            >
              {t(($) => $['operations.exportPipeline'], { ns: 'datasetPipeline' })}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={onDelete}>
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </div>
  )
}

export default React.memo(Actions)
