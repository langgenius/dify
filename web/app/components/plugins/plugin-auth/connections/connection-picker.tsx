import type { ReactNode } from 'react'
import type { CredentialTypeEnum as CredentialType } from '../types'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { CredentialTypeEnum } from '../types'

export type ConnectionPickerOption = {
  id: string
  name: string
  subtitle: string
  method?: CredentialType
  disabled?: boolean
  info?: string
}

export type ConnectionPickerGroup = {
  label: string
  items: ConnectionPickerOption[]
}

type ConnectionPickerAction = {
  onClick: () => void
  disabled?: boolean
}

export type ConnectionPickerProps = {
  groups: ConnectionPickerGroup[]
  selected?: ConnectionPickerOption
  fallbackName: string
  unavailable?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (id: string) => void
  renderActions?: (id: string) => ReactNode
  actions?: {
    addOAuth?: ConnectionPickerAction
    addApiKey?: ConnectionPickerAction
    oauthClientSettings?: ConnectionPickerAction
  }
}

const ConnectionPicker = ({
  groups,
  selected,
  fallbackName,
  unavailable,
  open,
  onOpenChange,
  onSelect,
  renderActions,
  actions,
}: ConnectionPickerProps) => {
  const { t } = useTranslation(['plugin'])
  const selectedName = selected?.name || fallbackName
  const methodLabel = (method: CredentialType) =>
    method === CredentialTypeEnum.OAUTH2
      ? t(($) => $['auth.connection.oauth'], { ns: 'plugin' })
      : t(($) => $['auth.connection.apiKey'], { ns: 'plugin' })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger className="flex h-13 w-full cursor-pointer items-center gap-0.5 rounded-lg bg-components-input-bg-normal px-1 py-1.5 text-left hover:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt">
        <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
          <Avatar size="xs" className="border-[0.5px] border-divider-regular">
            <AvatarFallback className="bg-components-icon-bg-blue-soft text-xs text-text-accent">
              {selectedName[0]?.toLocaleUpperCase()}
            </AvatarFallback>
          </Avatar>
        </span>
        <span className="flex min-w-0 grow flex-col gap-0.5 px-1 py-0.75">
          {/* The connection picker discloses the complete name through its wrapping rows. */}
          <span
            className={cn(
              'truncate system-sm-regular text-components-input-text-filled',
              unavailable && 'text-text-destructive',
            )}
          >
            {selectedName}
          </span>
          <span className="truncate system-xs-regular text-text-tertiary">
            {selected?.subtitle ?? t(($) => $['auth.unavailable'], { ns: 'plugin' })}
          </span>
        </span>
        <span
          aria-hidden
          className="mr-1 i-ri-arrow-down-s-line size-4 shrink-0 text-text-tertiary"
        />
      </PopoverTrigger>
      <PopoverContent
        placement="bottom-start"
        sideOffset={8}
        className="max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) overflow-y-auto bg-components-panel-bg-blur p-1 backdrop-blur-[5px]"
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['auth.authorization'], { ns: 'plugin' })}
        </PopoverTitle>
        <div className="space-y-0.5">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.label} role="group" aria-label={group.label}>
                <div className="px-2 pt-2 pb-1 system-xs-regular text-text-tertiary">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((option) => {
                    const isSelected = selected?.id === option.id
                    return (
                      <div
                        key={option.id}
                        className={cn(
                          'flex min-h-12.5 items-center rounded-lg pr-2 hover:bg-state-base-hover',
                          isSelected && 'bg-background-section-burn',
                        )}
                      >
                        <Button
                          variant="ghost"
                          aria-pressed={isSelected}
                          // Match the connection row's 8px spacing rather than a compact action label.
                          className="h-auto min-w-0 grow justify-start gap-2 p-2 text-left hover:bg-transparent"
                          disabled={option.disabled}
                          onClick={() => onSelect(option.id)}
                        >
                          <span
                            aria-hidden
                            className="flex size-3.5 shrink-0 items-center justify-center"
                          >
                            {isSelected && (
                              <span
                                aria-hidden
                                className="i-ri-check-line size-3.5 text-text-accent"
                              />
                            )}
                          </span>
                          <span className="flex min-w-0 grow flex-col gap-0.5">
                            <span className="system-sm-medium wrap-anywhere whitespace-normal text-components-input-text-filled">
                              {option.name}
                            </span>
                            <span className="truncate system-xs-regular text-text-tertiary">
                              {option.subtitle}
                            </span>
                          </span>
                          {option.method && (
                            <span className="shrink-0 system-xs-regular text-text-tertiary">
                              {methodLabel(option.method)}
                            </span>
                          )}
                        </Button>
                        {option.info && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="flex shrink-0 items-center text-text-tertiary">
                                  <span aria-hidden className="i-ri-information-line size-4" />
                                </span>
                              }
                            />
                            <TooltipContent>{option.info}</TooltipContent>
                          </Tooltip>
                        )}
                        {renderActions?.(option.id)}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
        {actions && (
          <div className="space-y-1 px-1 pt-2 pb-0.5">
            <div className="flex gap-2">
              {actions.addOAuth && (
                <Button
                  className="min-w-0 flex-1"
                  disabled={actions.addOAuth.disabled}
                  onClick={actions.addOAuth.onClick}
                >
                  {t(($) => $['auth.addOAuth'], { ns: 'plugin' })}
                </Button>
              )}
              {actions.addApiKey && (
                <Button
                  className="min-w-0 flex-1"
                  disabled={actions.addApiKey.disabled}
                  onClick={actions.addApiKey.onClick}
                >
                  {t(($) => $['auth.common.addApiKey'], { ns: 'plugin' })}
                </Button>
              )}
            </div>
            {actions.oauthClientSettings && (
              <Button
                variant="ghost"
                className="w-full"
                disabled={actions.oauthClientSettings.disabled}
                onClick={actions.oauthClientSettings.onClick}
              >
                <span aria-hidden className="i-ri-equalizer-2-line size-4" />
                {t(($) => $['auth.connection.oauthClientSettings'], { ns: 'plugin' })}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default ConnectionPicker
