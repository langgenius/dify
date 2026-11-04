'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '@langgenius/dify-ui/menu'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourMenuContentProps,
  useStepByStepTourControlledMenu,
} from '@/app/components/step-by-step-tour/menu'

type CreateAppMenuProps = {
  onCreateBlank?: () => void
  onCreateTemplate?: () => void
  onImportDSL?: () => void
  stepByStepTourControlledOpen?: boolean
  stepByStepTourTarget?: string
  stepByStepTourHighlightPart?: string
}

export function CreateAppMenu({
  onCreateBlank,
  onCreateTemplate,
  onImportDSL,
  stepByStepTourControlledOpen,
  stepByStepTourTarget,
  stepByStepTourHighlightPart,
}: CreateAppMenuProps) {
  const { t } = useTranslation(['app', 'common'])
  const menu = useStepByStepTourControlledMenu({
    controlledOpen: stepByStepTourControlledOpen,
  })

  return (
    <Menu modal={false} open={menu.open} onOpenChange={menu.onOpenChange}>
      <MenuTrigger
        render={
          <Button
            data-step-by-step-tour-target={stepByStepTourTarget}
            variant="primary"
            size="medium"
            className="px-2 whitespace-nowrap shadow-xs shadow-shadow-shadow-3"
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
            <span>{t(($) => $['operation.create'], { ns: 'common' })}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
          </Button>
        }
      />
      <MenuContent
        align="end"
        {...getStepByStepTourMenuContentProps({
          disableMotion: menu.controlled,
          highlightPart: menu.controlled ? stepByStepTourHighlightPart : undefined,
          interactionMode: menu.controlled ? 'presentation' : 'interactive',
          className: 'w-70 p-0',
        })}
      >
        {(onCreateBlank || onCreateTemplate) && (
          <MenuGroup className="py-1">
            {onCreateBlank && (
              <MenuItem
                className="py-1 system-md-regular text-text-secondary"
                onClick={onCreateBlank}
              >
                <span
                  aria-hidden
                  className="i-ri-sticky-note-add-line size-4 shrink-0 text-text-secondary"
                />
                <span className="min-w-0 flex-1 truncate px-1">
                  {t(($) => $['newApp.startFromBlank'], { ns: 'app' })}
                </span>
              </MenuItem>
            )}
            {onCreateTemplate && (
              <MenuItem
                className="py-1 system-md-regular text-text-secondary"
                onClick={onCreateTemplate}
              >
                <span
                  aria-hidden
                  className="i-ri-apps-2-add-line size-4 shrink-0 text-text-secondary"
                />
                <span className="min-w-0 flex-1 truncate px-1">
                  {t(($) => $['newApp.startFromTemplate'], { ns: 'app' })}
                </span>
              </MenuItem>
            )}
          </MenuGroup>
        )}
        {onImportDSL && (onCreateBlank || onCreateTemplate) && <MenuSeparator className="my-0" />}
        {onImportDSL && (
          <MenuGroup className="py-1">
            <MenuItem className="h-auto items-start py-1.5" onClick={onImportDSL}>
              <span className="flex h-5 shrink-0 items-center py-0.5">
                <span aria-hidden className="i-ri-file-upload-line size-4 text-text-secondary" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-1">
                <span className="system-md-regular text-text-secondary">
                  {t(($) => $.importApp, { ns: 'app' })}
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $.importAppDescription, { ns: 'app' })}
                </span>
              </span>
            </MenuItem>
          </MenuGroup>
        )}
      </MenuContent>
    </Menu>
  )
}
