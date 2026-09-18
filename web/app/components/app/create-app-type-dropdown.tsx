'use client'

import type { CreateAppPayload } from '@dify/contracts/api/console/apps/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getStepByStepTourDropdownMenuContentProps,
  useStepByStepTourControlledDropdown,
} from '@/app/components/step-by-step-tour/dropdown-menu'

export type CreateAppTypeDropdownProps = {
  onSelectType: (mode: CreateAppPayload['mode']) => void
  onCreateTemplate?: () => void
  onImportDSL?: () => void
  disabled?: boolean
  loading?: boolean
  stepByStepTourControlledOpen?: boolean
  stepByStepTourTarget?: string
  stepByStepTourHighlightPart?: string
}

function AppTypeItem({
  label,
  description,
  icon,
  onClick,
  disabled,
}: {
  label: string
  description: string
  icon: string
  onClick: () => void
  disabled?: boolean
}) {
  const descriptionId = useId()
  return (
    <Tooltip disableHoverablePopup>
      <TooltipTrigger
        delay={200}
        render={
          <DropdownMenuItem
            nativeButton
            render={<button type="button" />}
            aria-describedby={descriptionId}
            className="mx-0 min-h-8 w-full gap-2 rounded-lg px-2 py-1 text-left system-md-regular text-text-secondary"
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <span aria-hidden className={cn('size-4 shrink-0 text-text-tertiary', icon)} />
        <span className="min-w-0 flex-1">{label}</span>
      </TooltipTrigger>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <TooltipContent
        role="tooltip"
        placement="left-start"
        sideOffset={8}
        className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-4 py-3.5 text-text-secondary shadow-lg backdrop-blur-sm"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  )
}

function AppTypes({
  onSelectType,
  disabled,
}: Pick<CreateAppTypeDropdownProps, 'onSelectType' | 'disabled'>) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const moreTypesId = useId()
  const types = [
    {
      mode: 'workflow',
      label: t(($) => $['types.workflow'], { ns: 'app' }),
      description: t(($) => $['newApp.menu.workflowDescription'], { ns: 'app' }),
      icon: 'i-ri-exchange-2-line',
    },
    {
      mode: 'advanced-chat',
      label: t(($) => $['types.advanced'], { ns: 'app' }),
      description: t(($) => $['newApp.menu.chatflowDescription'], { ns: 'app' }),
      icon: 'i-custom-vender-line-app-types-chatflow',
    },
    {
      mode: 'agent-chat',
      label: t(($) => $['types.agent'], { ns: 'app' }),
      description: t(($) => $['newApp.menu.agentDescription'], { ns: 'app' }),
      icon: 'i-custom-vender-line-app-types-agent',
    },
    {
      mode: 'chat',
      label: t(($) => $['types.chatbot'], { ns: 'app' }),
      description: t(($) => $['newApp.menu.chatbotDescription'], { ns: 'app' }),
      icon: 'i-custom-vender-line-app-types-chatbot',
    },
    {
      mode: 'completion',
      label: t(($) => $['newApp.completeApp'], { ns: 'app' }),
      description: t(($) => $['newApp.menu.completionDescription'], { ns: 'app' }),
      icon: 'i-custom-vender-line-app-types-completion',
    },
  ] satisfies { mode: CreateAppPayload['mode']; label: string; description: string; icon: string }[]

  return (
    <div className="p-1">
      {types.slice(0, 2).map((type) => (
        <AppTypeItem
          key={type.mode}
          {...type}
          disabled={disabled}
          onClick={() => onSelectType(type.mode)}
        />
      ))}
      <DropdownMenuItem
        nativeButton
        render={<button type="button" />}
        closeOnClick={false}
        aria-expanded={expanded}
        aria-controls={moreTypesId}
        className="mx-0 mt-1 h-6 w-full gap-2 rounded-lg px-2 py-1 system-xs-medium-uppercase text-text-tertiary"
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          aria-hidden
          className={cn('i-ri-arrow-down-s-line size-4 shrink-0', expanded && 'rotate-180')}
        />
        {t(($) => $['newApp.menu.moreTypes'], { ns: 'app' })}
      </DropdownMenuItem>
      <div id={moreTypesId} hidden={!expanded}>
        {expanded &&
          types
            .slice(2)
            .map((type) => (
              <AppTypeItem
                key={type.mode}
                {...type}
                disabled={disabled}
                onClick={() => onSelectType(type.mode)}
              />
            ))}
      </div>
    </div>
  )
}

export function CreateAppTypeDropdown({
  onSelectType,
  onCreateTemplate,
  onImportDSL,
  disabled,
  loading,
  stepByStepTourControlledOpen,
  stepByStepTourTarget,
  stepByStepTourHighlightPart,
}: CreateAppTypeDropdownProps) {
  const { t } = useTranslation()
  const menu = useStepByStepTourControlledDropdown({ controlledOpen: stepByStepTourControlledOpen })

  return (
    <DropdownMenu modal={false} open={menu.open} onOpenChange={menu.onOpenChange}>
      <DropdownMenuTrigger
        render={
          <Button
            data-step-by-step-tour-target={stepByStepTourTarget}
            variant="primary"
            size="medium"
            loading={loading}
            className="px-2 whitespace-nowrap shadow-xs shadow-shadow-shadow-3"
          >
            <span aria-hidden className="i-ri-add-line size-4 shrink-0" />
            <span>{t(($) => $['operation.create'], { ns: 'common' })}</span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
          </Button>
        }
      />
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={4}
        {...getStepByStepTourDropdownMenuContentProps({
          disableMotion: menu.controlled,
          highlightPart: menu.controlled ? stepByStepTourHighlightPart : undefined,
          interactionMode: menu.controlled ? 'presentation' : 'interactive',
          className: 'w-64 max-w-[calc(100vw-2rem)] p-0',
        })}
      >
        <AppTypes onSelectType={onSelectType} disabled={disabled || loading} />
        {(onCreateTemplate || onImportDSL) && <DropdownMenuSeparator className="m-0" />}
        <div className="p-1">
          {onCreateTemplate && (
            <DropdownMenuItem
              nativeButton
              render={<button type="button" />}
              className="mx-0 min-h-8 w-full gap-2 rounded-lg px-2 py-1 text-left system-md-regular text-text-secondary"
              onClick={onCreateTemplate}
            >
              <span
                aria-hidden
                className="i-ri-apps-2-add-line size-4 shrink-0 text-text-tertiary"
              />
              <span className="min-w-0 flex-1">
                {t(($) => $['newApp.menu.startFromTemplate'], { ns: 'app' })}
              </span>
            </DropdownMenuItem>
          )}
          {onImportDSL && (
            <DropdownMenuItem
              nativeButton
              render={<button type="button" />}
              className="mx-0 h-auto w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left"
              onClick={onImportDSL}
            >
              <span
                aria-hidden
                className="mt-0.5 i-ri-file-upload-line size-4 shrink-0 text-text-tertiary"
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="system-md-regular text-text-secondary">
                  {t(($) => $.importDSL, { ns: 'app' })}
                </span>
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['newApp.menu.importDSLHint'], { ns: 'app' })}
                </span>
              </span>
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
