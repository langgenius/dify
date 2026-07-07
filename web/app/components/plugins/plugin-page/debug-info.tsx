'use client'
import type { Placement } from '@langgenius/dify-ui/popover'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  RiArrowRightUpLine,
  RiBugLine,
} from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { useDebugKey } from '@/service/use-plugins'
import KeyValueItem from '../base/key-value-item'
import { PluginSidecarPanel } from './plugin-sidecar-panel'

const i18nPrefix = 'debugInfo'

type DebugInfoProps = {
  popupPlacement?: Placement
  triggerClassName?: string
  triggerContent?: ReactNode
  triggerVariant?: ComponentProps<typeof Button>['variant']
}

function DebugInfo({
  popupPlacement = 'bottom',
  triggerClassName,
  triggerContent,
  triggerVariant = 'secondary',
}: DebugInfoProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { data: info, isLoading } = useDebugKey()
  const trigger = triggerContent ?? <RiBugLine className="size-4" />
  const triggerClassNames = cn(
    !triggerClassName && 'size-full p-2 text-components-button-secondary-text',
    triggerClassName,
  )

  // info.key likes 4580bdb7-b878-471c-a8a4-bfd760263a53 mask the middle part using *.
  const maskedKey = info?.key?.replace(/(.{8})(.*)(.{8})/, '$1********$3')

  if (isLoading)
    return null

  if (!info) {
    return (
      <Button variant={triggerVariant} className={triggerClassNames} disabled>
        {trigger}
      </Button>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={(
          <Button variant={triggerVariant} className={triggerClassNames}>
            {trigger}
          </Button>
        )}
      />
      <PopoverContent
        placement={popupPlacement}
        popupClassName="border-0 bg-transparent p-0 shadow-none"
      >
        <PluginSidecarPanel
          title={t(`${i18nPrefix}.title`, { ns: 'plugin' })}
          footer={(
            <div className="flex w-full shrink-0 flex-col items-start">
              <div className="flex w-full shrink-0 items-center justify-end gap-2 px-4 pt-2 pb-4">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <a
                    href={docLink('/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex cursor-pointer items-center gap-1 system-xs-regular text-text-accent"
                  >
                    <span>{t(`${i18nPrefix}.viewDocs`, { ns: 'plugin' })}</span>
                    <RiArrowRightUpLine className="size-3" />
                  </a>
                </div>
              </div>
            </div>
          )}
        >
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-1 px-4 py-2">
            <KeyValueItem
              label="Port"
              value={`${info.host}:${info.port}`}
            />
            <KeyValueItem
              label="Key"
              value={info.key || ''}
              maskedValue={maskedKey}
              valueMaxWidthClassName="max-w-[224px]"
            />
          </div>
        </PluginSidecarPanel>
      </PopoverContent>
    </Popover>
  )
}

export default DebugInfo
