'use client'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import KeyValueItem from '../base/key-value-item'
import { PluginSidecarPanel } from './plugin-sidecar-panel'

const i18nPrefix = 'debugInfo'

type DebugInfoProps = {
  triggerClassName?: string
  triggerContent?: ReactNode
  triggerVariant?: ButtonProps['variant']
}

function DebugInfo({
  triggerClassName,
  triggerContent,
  triggerVariant = 'secondary',
}: DebugInfoProps) {
  const { t } = useTranslation(['plugin', 'common'])
  const docLink = useDocLink()
  const debuggingKeyQuery = useQuery(
    consoleQuery.workspaces.current.plugin.debuggingKey.get.queryOptions(),
  )
  const { data: info, isError, isLoading } = debuggingKeyQuery
  const title = t(($) => $[`${i18nPrefix}.title`], { ns: 'plugin' })
  const trigger = triggerContent ?? <span aria-hidden className="i-ri-bug-line size-4" />
  const triggerClassNames = cn(
    !triggerClassName && 'size-full p-2 text-components-button-secondary-text',
    triggerClassName,
  )

  // info.key likes 4580bdb7-b878-471c-a8a4-bfd760263a53 mask the middle part using *.
  const maskedKey = info?.key?.replace(/(.{8})(.*)(.{8})/, '$1********$3')

  if (isLoading) return null

  // The trigger still opens so the panel can say why the debugging key is missing.
  if (isError && info === undefined) {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <Button variant={triggerVariant} className={triggerClassNames} aria-label={title}>
              {trigger}
            </Button>
          }
        />
        <PopoverContent side="top" align="start" className="w-80 border-0 bg-transparent p-0">
          <DebuggingKeyLoadError query={debuggingKeyQuery} />
        </PopoverContent>
      </Popover>
    )
  }

  if (!info) {
    return (
      <Button variant={triggerVariant} className={triggerClassNames} aria-label={title} disabled>
        {trigger}
      </Button>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant={triggerVariant} className={triggerClassNames} aria-label={title}>
            {trigger}
          </Button>
        }
      />
      <PopoverContent side="top" align="start" className="border-0 bg-transparent p-0 shadow-none">
        <PluginSidecarPanel
          title={title}
          footer={
            <div className="flex w-full shrink-0 flex-col items-start">
              <div className="flex w-full shrink-0 items-center justify-end gap-2 px-4 pt-2 pb-4">
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <a
                    href={docLink(
                      '/develop-plugin/features-and-specs/plugin-types/remote-debug-a-plugin',
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex cursor-pointer items-center gap-1 rounded-xs system-xs-regular text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                  >
                    <span>{t(($) => $[`${i18nPrefix}.viewDocs`], { ns: 'plugin' })}</span>
                    <span aria-hidden className="i-ri-arrow-right-up-line size-3" />
                  </a>
                </div>
              </div>
            </div>
          }
        >
          <div className="flex w-full shrink-0 flex-col items-start justify-center gap-1 px-4 py-2">
            <KeyValueItem label="Port" value={`${info.host}:${info.port}`} />
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

/** Mounted only inside the open popover, so a failed load is claimed only while it is shown. */
function DebuggingKeyLoadError({ query }: { query: UseQueryResult<unknown> }) {
  const { t } = useTranslation(['common'])
  const debuggingKeyLoad = useOwnedQueryError(query)
  const loadErrorMessage = useRequestErrorMessage(debuggingKeyLoad?.error)
  if (!debuggingKeyLoad) return null

  return (
    <Alert type="error">
      <AlertTitle>{loadErrorMessage}</AlertTitle>
      <AlertActions>
        <Button size="small" loading={debuggingKeyLoad.retrying} onClick={debuggingKeyLoad.retry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      </AlertActions>
    </Alert>
  )
}

export default DebugInfo
