'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'

type CreateAppDropdownProps = {
  onCreateBlank: () => void
  onCreateTemplate?: () => void
  onImportDSL: () => void
}

export function CreateAppDropdown({
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
}: CreateAppDropdownProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="primary"
            size="medium"
            className="gap-0.5 px-2 whitespace-nowrap shadow-xs shadow-shadow-shadow-3"
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
            <span className="pl-1">{t(($) => $['operation.create'], { ns: 'common' })}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="w-70 p-0">
        <div className="py-1">
          <DropdownMenuItem
            className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
            onClick={onCreateBlank}
          >
            <span
              aria-hidden
              className="i-ri-sticky-note-add-line size-4 shrink-0 text-text-secondary"
            />
            <span className="min-w-0 flex-1 truncate px-1">
              {t(($) => $['newApp.startFromBlank'], { ns: 'app' })}
            </span>
          </DropdownMenuItem>
          {onCreateTemplate && (
            <DropdownMenuItem
              className="h-8 gap-1 rounded-lg px-2 py-1 system-md-regular text-text-secondary"
              onClick={onCreateTemplate}
            >
              <span
                aria-hidden
                className="i-ri-apps-2-add-line size-4 shrink-0 text-text-secondary"
              />
              <span className="min-w-0 flex-1 truncate px-1">
                {t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
              </span>
            </DropdownMenuItem>
          )}
        </div>
        <div className="h-px bg-divider-subtle" />
        <div className="py-1">
          <DropdownMenuItem
            className={cn(
              'h-auto items-start gap-1 rounded-lg px-2 py-1.5',
              'hover:bg-state-base-hover focus:bg-state-base-hover',
            )}
            onClick={onImportDSL}
          >
            <span className="flex h-5 shrink-0 items-center py-0.5">
              <span aria-hidden className="i-ri-file-upload-line size-4 text-text-secondary" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1">
              <span className="system-md-regular text-text-secondary">
                {t(($) => $.importDSL, { ns: 'app' })}
              </span>
              <span className="system-xs-regular text-text-tertiary">
                {t(($) => $['newApp.dropDSLToCreateApp'], { ns: 'app' })}
              </span>
            </span>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
