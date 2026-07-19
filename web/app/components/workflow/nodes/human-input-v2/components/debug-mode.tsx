'use client'

import type { HumanInputV2DebugMode } from '../types'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS, isHumanInputV2DebugChannel } from '../types'

type DebugModeProps = {
  value: HumanInputV2DebugMode
  onChange: (value: HumanInputV2DebugMode) => void
  readonly: boolean
}

const DebugMode = ({ value, onChange, readonly }: DebugModeProps) => {
  const { t } = useTranslation()
  const errorId = useId()
  const [open, setOpen] = useState(false)
  const channels = value.channels as string[]
  const unsupported = channels.filter((channel) => !isHumanInputV2DebugChannel(channel))
  const selected = channels.filter(isHumanInputV2DebugChannel)

  const toggleChannel = (channel: (typeof HUMAN_INPUT_V2_DEBUG_CHANNELS)[number]) => {
    const nextChannels = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel]
    onChange({ ...value, channels: nextChannels as HumanInputV2DebugMode['channels'] })
  }

  return (
    <section
      className="px-4 py-2"
      aria-describedby={
        (value.enabled && !selected.length) || unsupported.length ? errorId : undefined
      }
    >
      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border border-components-option-card-option-border bg-background-section px-2',
          readonly && 'opacity-70',
        )}
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-text-primary-on-surface">
          <span className="i-ri-notification-3-line size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 grow">
          <div className="system-xs-medium text-text-secondary">
            {t(($) => $['nodes.humanInputV2.debug.title'], { ns: 'workflow' })}
          </div>
          {!!selected.length && (
            <div className="truncate system-2xs-regular text-text-tertiary">
              {selected
                .map((channel) =>
                  t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], { ns: 'workflow' }),
                )
                .join(', ')}
            </div>
          )}
        </div>
        <Popover open={open} onOpenChange={(nextOpen) => !readonly && setOpen(nextOpen)}>
          <PopoverTrigger
            render={
              <button
                type="button"
                disabled={readonly}
                aria-label={t(($) => $['nodes.humanInputV2.debug.configure'], { ns: 'workflow' })}
                className="flex size-6 items-center justify-center rounded-md border-0 bg-transparent text-text-tertiary hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed"
              >
                <span className="i-ri-settings-3-line size-4" aria-hidden />
              </button>
            }
          />
          <PopoverContent placement="bottom-end" sideOffset={4} className="w-60! p-2!">
            <div className="mb-1 system-xs-medium text-text-secondary">
              {t(($) => $['nodes.humanInputV2.debug.sendVia'], { ns: 'workflow' })}
            </div>
            {HUMAN_INPUT_V2_DEBUG_CHANNELS.map((channel) => (
              <label
                key={channel}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-1 hover:bg-state-base-hover"
              >
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={() => toggleChannel(channel)}
                />
                <span className="flex size-5 items-center justify-center rounded-md bg-components-icon-bg-blue-solid text-text-primary-on-surface">
                  <span className="i-ri-notification-line size-3" aria-hidden />
                </span>
                <span className="system-xs-regular text-text-secondary">
                  {t(($) => $[`nodes.humanInputV2.debug.channel.${channel}`], { ns: 'workflow' })}
                </span>
              </label>
            ))}
          </PopoverContent>
        </Popover>
        <div className="h-4 w-px bg-divider-regular" />
        <Switch
          aria-label={t(($) => $['nodes.humanInputV2.debug.toggle'], { ns: 'workflow' })}
          aria-describedby={value.enabled && !selected.length ? errorId : undefined}
          checked={value.enabled}
          disabled={readonly}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      {value.enabled && !selected.length && (
        <div id={errorId} role="alert" className="mt-1 system-xs-regular text-text-destructive">
          {t(($) => $['nodes.humanInputV2.error.debugChannelRequired'], { ns: 'workflow' })}
        </div>
      )}
      {!!unsupported.length && (
        <div
          id={value.enabled && !selected.length ? undefined : errorId}
          role="alert"
          className="mt-1 system-xs-regular text-text-destructive"
        >
          {t(($) => $['nodes.humanInputV2.debug.unsupported'], {
            ns: 'workflow',
            channels: unsupported.join(', '),
          })}
        </div>
      )}
    </section>
  )
}

export default DebugMode
