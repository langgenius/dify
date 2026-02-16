'use client'
import type { FC } from 'react'
import type { TryAppInfo } from '@/service/try-app'
import Image from 'next/image'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'
import useGetRequirements from './use-get-requirements'

type Props = {
  appId: string
  appDetail: TryAppInfo
  category?: string
  className?: string
  onCreate: () => void
}

const headerClassName = 'system-sm-semibold-uppercase text-text-secondary mb-3'
const requirementIconSize = 20

type RequirementIconProps = {
  iconUrl: string
}

const RequirementIcon: FC<RequirementIconProps> = ({ iconUrl }) => {
  const [failedSource, setFailedSource] = React.useState<string | null>(null)
  const hasLoadError = !iconUrl || failedSource === iconUrl

  if (hasLoadError) {
    return (
      <div className="flex size-5 items-center justify-center overflow-hidden rounded-[6px] border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        <div className="i-custom-public-other-default-tool-icon size-3 text-text-tertiary" />
      </div>
    )
  }

  return (
    <Image
      className="size-5 rounded-md object-cover shadow-xs"
      src={iconUrl}
      alt=""
      aria-hidden="true"
      width={requirementIconSize}
      height={requirementIconSize}
      unoptimized
      onError={() => setFailedSource(iconUrl)}
    />
  )
}

const AppInfo: FC<Props> = ({
  appId,
  className,
  category,
  appDetail,
  onCreate,
}) => {
  const { t } = useTranslation()
  const mode = appDetail?.mode
  const { requirements } = useGetRequirements({ appDetail, appId })
  return (
    <div className={cn('flex h-full flex-col px-4 pt-2', className)}>
      {/* name and icon */}
      <div className="flex shrink-0 grow-0 items-center gap-3">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={appDetail.site.icon_type}
            icon={appDetail.site.icon}
            background={appDetail.site.icon_background}
            imageUrl={appDetail.site.icon_url}
          />
          <AppTypeIcon
            wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm"
            className="h-3 w-3"
            type={mode}
          />
        </div>
        <div className="w-0 grow py-[1px]">
          <div className="flex items-center text-sm font-semibold leading-5 text-text-secondary">
            <div className="truncate" title={appDetail.name}>{appDetail.name}</div>
          </div>
          <div className="flex items-center text-[10px] font-medium leading-[18px] text-text-tertiary">
            {mode === 'advanced-chat' && <div className="truncate">{t('types.advanced', { ns: 'app' }).toUpperCase()}</div>}
            {mode === 'chat' && <div className="truncate">{t('types.chatbot', { ns: 'app' }).toUpperCase()}</div>}
            {mode === 'agent-chat' && <div className="truncate">{t('types.agent', { ns: 'app' }).toUpperCase()}</div>}
            {mode === 'workflow' && <div className="truncate">{t('types.workflow', { ns: 'app' }).toUpperCase()}</div>}
            {mode === 'completion' && <div className="truncate">{t('types.completion', { ns: 'app' }).toUpperCase()}</div>}
          </div>
        </div>
      </div>
      {appDetail.description && (
        <div className="mt-[14px] shrink-0 text-text-secondary system-sm-regular">{appDetail.description}</div>
      )}
      <Button variant="primary" className="mt-3 flex w-full max-w-full" onClick={onCreate}>
        <span className="i-ri-add-line mr-1 size-4 shrink-0" />
        <span className="truncate">{t('tryApp.createFromSampleApp', { ns: 'explore' })}</span>
      </Button>

      {category && (
        <div className="mt-6 shrink-0">
          <div className={headerClassName}>{t('tryApp.category', { ns: 'explore' })}</div>
          <div className="text-text-secondary system-md-regular">{category}</div>
        </div>
      )}
      {requirements.length > 0 && (
        <div className="mt-5 grow overflow-y-auto">
          <div className={headerClassName}>{t('tryApp.requirements', { ns: 'explore' })}</div>
          <div className="space-y-0.5">
            {requirements.map(item => (
              <div className="flex items-center space-x-2 py-1" key={item.name}>
                <RequirementIcon iconUrl={item.iconUrl} />
                <div className="w-0 grow truncate text-text-secondary system-md-regular">{item.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
export default React.memo(AppInfo)
