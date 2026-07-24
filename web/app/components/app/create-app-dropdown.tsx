'use client'

import { buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'

type CreateAppDropdownProps = {
  onCreateBlank: () => void
  onCreateTemplate?: () => void
  onImportDSL: () => void
  stepByStepTourControlledOpen?: boolean
  stepByStepTourTarget?: string
  stepByStepTourHighlightPart?: string
}

export function CreateAppDropdown({
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
  stepByStepTourControlledOpen,
  stepByStepTourTarget,
  stepByStepTourHighlightPart,
}: CreateAppDropdownProps) {
  const { t } = useTranslation()
  const menu = useStepByStepTourControlledDropdown({
    controlledOpen: stepByStepTourControlledOpen,
  })
  const isControlledByStepByStepTour = stepByStepTourControlledOpen === true

  return (
    <DropdownMenu
      key={isControlledByStepByStepTour ? 'step-by-step-tour' : 'interactive'}
      modal={false}
      {...(isControlledByStepByStepTour
        ? { open: menu.open, onOpenChange: menu.onOpenChange }
        : undefined)}
    >
      <DropdownMenuTrigger
        data-step-by-step-tour-target={stepByStepTourTarget}
        className={cn(
          buttonVariants({ variant: 'primary', size: 'medium' }),
          'gap-0.5 px-2 whitespace-nowrap shadow-xs shadow-shadow-shadow-3',
        )}
      >
        <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
        <span className="pl-1">{t(($) => $['operation.create'], { ns: 'common' })}</span>
        <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        {...getStepByStepTourDropdownMenuContentProps({
          disableMotion: menu.controlled,
          highlightPart: menu.controlled ? stepByStepTourHighlightPart : undefined,
          interactionMode: menu.controlled ? 'presentation' : 'interactive',
          popupClassName: 'w-70 p-0',
        })}
      >
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
