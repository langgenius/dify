'use client'
import type { AgentAppComposerResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { FC } from 'react'
import type { TryAppInfo } from '@/service/try-app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AppTypeIcon } from '@/app/components/app/type-selector'
import AppIcon from '@/app/components/base/app-icon'
import useGetRequirements from './use-get-requirements'

type Props = Readonly<{
  appId: string
  appDetail: TryAppInfo
  canCreate?: boolean
  categories?: string[]
  className?: string
  createButtonStepByStepTourTarget?: string
  onCreate: () => void
  agentComposer?: AgentAppComposerResponse
}>

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
      <div className="flex size-5 items-center justify-center overflow-hidden rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-dodge">
        <div className="i-custom-public-other-default-tool-icon size-3 text-text-tertiary" />
      </div>
    )
  }

  return (
    <img
      className="size-5 rounded-md object-cover shadow-xs"
      src={iconUrl}
      alt=""
      aria-hidden="true"
      width={requirementIconSize}
      height={requirementIconSize}
      onError={() => setFailedSource(iconUrl)}
    />
  )
}

const AppInfo: FC<Props> = ({
  appId,
  canCreate = true,
  className,
  categories,
  createButtonStepByStepTourTarget,
  appDetail,
  onCreate,
  agentComposer,
}) => {
  const { t } = useTranslation(['app', 'explore'])
  const mode = appDetail?.mode
  const visibleCategories = Array.from(new Set(categories?.filter(Boolean) ?? []))
  const { requirements } = useGetRequirements({ appDetail, appId, agentComposer })
  const skills = agentComposer?.agent_soul.config_skills ?? []
  const files = agentComposer?.agent_soul.config_files ?? []
  return (
    <div className={cn('flex h-full flex-col px-4 pt-2', className)}>
      {/* name and icon */}
      <div className="flex shrink-0 grow-0 items-center gap-3">
        <div className="relative shrink-0">
          <AppIcon
            size="large"
            iconType={appDetail.site.icon_type}
            icon={appDetail.site.icon ?? undefined}
            background={appDetail.site.icon_background ?? undefined}
            imageUrl={appDetail.site.icon_url ?? undefined}
          />
          <AppTypeIcon
            wrapperClassName="absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm"
            className="size-3"
            type={mode}
          />
        </div>
        <div className="w-0 grow py-px">
          <div className="flex items-center text-sm/5 font-semibold text-text-secondary">
            <div className="truncate" title={appDetail.name}>
              {appDetail.name}
            </div>
          </div>
          <div className="flex items-center text-2xs leading-4.5 font-medium text-text-tertiary">
            {mode === 'advanced-chat' && (
              <div className="truncate">
                {t(($) => $['types.advanced'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {mode === 'chat' && (
              <div className="truncate">
                {t(($) => $['types.chatbot'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {(mode === 'agent-chat' || mode === 'agent') && (
              <div className="truncate">
                {t(($) => $['types.agent'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {mode === 'workflow' && (
              <div className="truncate">
                {t(($) => $['types.workflow'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
            {mode === 'completion' && (
              <div className="truncate">
                {t(($) => $['types.completion'], { ns: 'app' }).toUpperCase()}
              </div>
            )}
          </div>
        </div>
      </div>
      {appDetail.description && (
        <div className="mt-3.5 shrink-0 system-sm-regular text-text-secondary">
          {appDetail.description}
        </div>
      )}
      {canCreate && (
        <Button
          variant="primary"
          className="mt-3 flex w-full max-w-full"
          data-step-by-step-tour-target={createButtonStepByStepTourTarget}
          onClick={onCreate}
        >
          <span className="i-ri-add-line size-4 shrink-0" />
          <span className="truncate">
            {t(($) => $['tryApp.createFromSampleApp'], { ns: 'explore' })}
          </span>
        </Button>
      )}

      {visibleCategories.length > 0 && (
        <div className="mt-6 shrink-0">
          <h2 className={headerClassName}>{t(($) => $['tryApp.category'], { ns: 'explore' })}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {visibleCategories.map((category) => (
              <li
                key={category}
                className="rounded-md border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark px-2 py-0.5 system-xs-medium text-text-secondary shadow-xs"
              >
                {category}
              </li>
            ))}
          </ul>
        </div>
      )}
      {requirements.length > 0 && (
        <div className="mt-5 grow overflow-y-auto">
          <h2 className={headerClassName}>
            {t(($) => $['tryApp.requirements'], { ns: 'explore' })}
          </h2>
          <ul className="space-y-0.5">
            {requirements.map((item) => (
              <li className="flex items-center space-x-2 py-1" key={item.name}>
                <RequirementIcon iconUrl={item.iconUrl} />
                <div className="w-0 grow truncate system-md-regular text-text-secondary">
                  {item.name}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {mode === 'agent' && (skills.length > 0 || files.length > 0) && (
        <section className="mt-5 min-h-0 overflow-y-auto">
          <h2 className={headerClassName}>{t(($) => $['tryApp.included'], { ns: 'explore' })}</h2>
          <ul className="space-y-1 system-sm-regular text-text-secondary">
            {skills.map((skill) => (
              <li key={`skill-${skill.name}`} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="i-custom-vender-agent-v2-building-blocks size-3.5 shrink-0"
                />
                <span className="min-w-0">{skill.name}</span>
              </li>
            ))}
            {files.map((file) => (
              <li key={`file-${file.name}`} className="flex items-center gap-2">
                <span aria-hidden="true" className="i-ri-file-line size-3.5 shrink-0" />
                <span className="min-w-0">{file.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {mode === 'agent' && (
        <p className="mt-auto pt-4 system-xs-regular text-text-tertiary">
          {t(($) => $['tryApp.agentSetupHint'], { ns: 'explore' })}
        </p>
      )}
    </div>
  )
}
export default React.memo(AppInfo)
