'use client'

import type { HumanInputV2DebugChannel, HumanInputV2DebugMode } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactChannelIcon } from '@/features/contacts/management/channel-icon'
import { basePath } from '@/utils/var'
import { isHumanInputV2DebugChannel } from '../types'
import useConfiguredChannels from '../use-configured-channels'

const debugModeBackground = `${basePath ?? ''}/assets/human-input/debug-mode-background.svg`

type DebugModeProps = {
  value: HumanInputV2DebugMode
  onChange: (value: HumanInputV2DebugMode) => void
  readonly: boolean
  email?: string
}

const DebugMode = ({ value, onChange, readonly, email }: DebugModeProps) => {
  const { t } = useTranslation(['workflow', 'contacts', 'common'])
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const configured = useConfiguredChannels()
  const channels = value.channels as string[]
  const unsupported = channels.filter((channel) => !isHumanInputV2DebugChannel(channel))
  const selected = channels
    .filter(isHumanInputV2DebugChannel)
    .filter((channel) => configured.channels.includes(channel))
  const missingSelection = configured.isSuccess && value.enabled && !selected.length

  const toggleChannel = (channel: HumanInputV2DebugChannel) => {
    if (
      readonly ||
      !configured.channels.includes(channel) ||
      (selected.length === 1 && selected[0] === channel)
    )
      return
    const nextChannels = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel]
    onChange({ ...value, channels: nextChannels as HumanInputV2DebugMode['channels'] })
  }

  return (
    <div
      className="px-4"
      aria-describedby={missingSelection || unsupported.length ? errorId : undefined}
    >
      <div
        className={cn(
          'relative flex h-9 items-center gap-2 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg ps-2 pe-2.5 shadow-xs',
          readonly && 'opacity-70',
        )}
      >
        <img
          src={debugModeBackground}
          alt=""
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 h-29 w-305 max-w-none -translate-x-1/2 -translate-y-1/2"
        />
        <span className="relative flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-components-icon-bg-orange-dark-solid bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100 text-text-primary-on-surface">
          <span className="i-ri-bug-line size-3.5" aria-hidden />
        </span>
        <div className="relative flex min-w-0 grow items-center gap-1">
          <div className="truncate system-sm-medium text-text-secondary">
            {t(($) => $['nodes.humanInputV2.debug.title'], { ns: 'workflow' })}
          </div>
          <Infotip>
            <InfotipTrigger
              aria-label={t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
            />
            <InfotipContent>
              {t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
            </InfotipContent>
          </Infotip>
        </div>
        <Popover open={open} onOpenChange={(nextOpen) => !readonly && setOpen(nextOpen)}>
          <PopoverTrigger
            render={
              <IconButton
                aria-describedby={selected.length ? `${errorId}-selected` : undefined}
                disabled={readonly}
                aria-label={t(($) => $['nodes.humanInputV2.debug.configure'], { ns: 'workflow' })}
                className="relative h-6 w-auto shrink-0 gap-1 px-1"
              >
                <span className="flex items-center gap-1">
                  {!!selected.length && (
                    <span aria-hidden="true" className="flex items-center gap-1">
                      {selected.map((channel) => (
                        <ContactChannelIcon key={channel} provider={channel} className="size-4" />
                      ))}
                    </span>
                  )}
                  <span className="i-ri-equalizer-2-line size-4" aria-hidden />
                </span>
              </IconButton>
            }
          />
          <span className="sr-only" id={`${errorId}-selected`}>
            {selected
              .map((channel) =>
                t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], { ns: 'workflow' }),
              )
              .join(', ')}
          </span>
          <PopoverContent
            side="bottom"
            align="end"
            sideOffset={4}
            className="w-60 bg-components-panel-bg-blur p-1 backdrop-blur-xs"
          >
            <div className="px-2 pt-1 pb-0.5 system-xs-medium text-text-tertiary">
              {t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
            </div>
            {configured.isPending && (
              <p role="status" className="px-2 py-1 system-xs-regular text-text-tertiary">
                {t(($) => $['imPlatform.loading'], { ns: 'contacts' })}
              </p>
            )}
            {configured.isError && (
              <div role="alert" className="px-2 py-1 system-xs-regular text-text-destructive">
                {t(($) => $['imPlatform.loadError.title'], { ns: 'contacts' })}
                <Button size="small" onClick={() => void configured.refetch()}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </div>
            )}
            {configured.isSuccess && !configured.channels.length && (
              <p role="status" className="px-2 py-1 system-xs-regular text-text-tertiary">
                {t(($) => $['nodes.humanInputV2.template.notConfigured'], { ns: 'workflow' })}
              </p>
            )}
            {configured.channels.map((channel) => {
              const isLastChannel = selected.length === 1 && selected[0] === channel
              const label = t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], {
                ns: 'workflow',
              })
              return (
                <label
                  key={channel}
                  className="flex min-h-8 items-center gap-1 rounded-lg px-2 hover:bg-state-base-hover"
                >
                  <Checkbox
                    aria-labelledby={`${errorId}-${channel}-label`}
                    aria-describedby={isLastChannel ? `${errorId}-keep-channel` : undefined}
                    checked={channels.includes(channel)}
                    disabled={readonly}
                    aria-disabled={isLastChannel || undefined}
                    onCheckedChange={() => toggleChannel(channel)}
                  />
                  <ContactChannelIcon provider={channel} className="ms-1 size-4 shrink-0" />
                  <span
                    id={`${errorId}-${channel}-label`}
                    className="shrink-0 system-md-regular text-text-secondary"
                  >
                    {label}
                  </span>
                  {channel === 'email' && email && (
                    <span className="truncate system-xs-regular text-text-tertiary" title={email}>
                      {email}
                    </span>
                  )}
                </label>
              )
            })}
            {selected.length === 1 && (
              <p
                id={`${errorId}-keep-channel`}
                className="px-2 py-1 system-xs-regular text-text-tertiary"
              >
                {t(($) => $['nodes.humanInputV2.debug.keepOneChannel'], { ns: 'workflow' })}
              </p>
            )}
          </PopoverContent>
        </Popover>
        <div className="relative h-3 w-1.25 shrink-0 border-s border-divider-regular" />
        <Switch
          aria-label={t(($) => $['nodes.humanInputV2.debug.toggle'], { ns: 'workflow' })}
          aria-describedby={missingSelection ? errorId : undefined}
          checked={value.enabled}
          disabled={readonly || (!value.enabled && !configured.channels.length)}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {missingSelection && (
        <div id={errorId} role="alert" className="mt-1 system-xs-regular text-text-destructive">
          {t(($) => $['nodes.humanInputV2.error.debugChannelRequired'], { ns: 'workflow' })}
        </div>
      )}
      {!!unsupported.length && (
        <div
          id={missingSelection ? undefined : errorId}
          role="alert"
          className="mt-1 system-xs-regular text-text-destructive"
        >
          {t(($) => $['nodes.humanInputV2.debug.unsupported'], {
            ns: 'workflow',
            channels: unsupported.join(', '),
          })}
        </div>
      )}
    </div>
  )
}

export default DebugMode
