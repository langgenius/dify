'use client'

import type { WorkflowVersion } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { MockVersion } from './mock-data'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

function isWorkflowVersion(version: MockVersion | WorkflowVersion): version is WorkflowVersion {
  return 'marked_name' in version
}

export function VersionLabel({
  version,
  versionsBehind,
}: {
  version?: MockVersion | WorkflowVersion
  versionsBehind?: number
}) {
  const { t } = useTranslation('deployments')
  const { formatTimeFromNow } = useFormatTimeFromNow()

  if (!version) return <span className="text-text-quaternary">--</span>

  const fromDeployment = isWorkflowVersion(version)
  const name = fromDeployment ? version.marked_name || version.version : version.name
  const description = fromDeployment ? version.marked_comment : version.description
  const publishedAt = fromDeployment ? undefined : version.publishedAt
  const publishedBy = fromDeployment ? undefined : version.publishedBy
  const latest = fromDeployment ? versionsBehind === 0 : version.latest
  const behind = fromDeployment
    ? versionsBehind !== undefined && versionsBehind > 0
      ? versionsBehind
      : undefined
    : version.behind
  const versionsBehindLabel =
    behind === undefined
      ? ''
      : behind === 1
        ? t(($) => $['studio.versionsBehind_one'], { count: behind })
        : t(($) => $['studio.versionsBehind_other'], { count: behind })

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={300}
          closeDelay={200}
          render={
            <button
              type="button"
              className="min-w-0 cursor-help truncate border-b border-dotted border-text-quaternary system-md-medium text-text-secondary outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
            >
              {name}
            </button>
          }
        />
        <PopoverContent
          placement="top"
          popupClassName="w-[296px] max-w-[calc(100vw-32px)] border-0 bg-components-tooltip-bg px-4 py-3.5 text-start inset-ring-[0.5px] inset-ring-components-panel-border backdrop-blur-[5px]"
        >
          <div className="flex flex-col gap-1">
            <PopoverTitle className="system-sm-semibold text-text-secondary">{name}</PopoverTitle>
            {publishedAt !== undefined && publishedBy && (
              <p className="system-xs-regular whitespace-nowrap text-text-tertiary">
                {t(($) => $['common.publishedBy'], {
                  ns: 'workflow',
                  time: formatTimeFromNow(publishedAt),
                  author: publishedBy,
                })}
              </p>
            )}
            {description && (
              <>
                <span className="my-1 h-px w-4 bg-divider-regular" />
                <PopoverDescription className="system-xs-regular text-text-tertiary">
                  {description}
                </PopoverDescription>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {latest && (
        <span className="inline-flex h-4.5 shrink-0 items-center rounded-[5px] border border-text-accent bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-accent">
          {t(($) => $['overview.chip.latest'])}
        </span>
      )}
      {behind !== undefined && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={versionsBehindLabel}
                className="inline-flex h-4.5 shrink-0 cursor-default items-center rounded-[5px] border border-util-colors-orange-orange-500 px-1 system-2xs-medium text-util-colors-orange-orange-600 outline-hidden focus-visible:ring-1 focus-visible:ring-state-accent-solid"
              >
                <span aria-hidden className="i-ri-arrow-up-line size-3" />
                {behind}
              </button>
            }
          />
          <TooltipContent>{versionsBehindLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
