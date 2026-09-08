import { cn } from '@langgenius/dify-ui/cn'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppModeEnum } from '@/types/app'

type AppTypeSelectorProps = {
  appMode: AppModeEnum
  onAppModeChange: (mode: AppModeEnum) => void
  isBuilder: boolean
  defaultAppMode?: AppModeEnum
}

export function AppTypeSelector({
  appMode,
  onAppModeChange,
  isBuilder,
  defaultAppMode,
}: AppTypeSelectorProps) {
  const { t } = useTranslation()
  const [isAppTypeExpanded, setIsAppTypeExpanded] = useState(
    defaultAppMode === AppModeEnum.CHAT ||
      defaultAppMode === AppModeEnum.AGENT_CHAT ||
      defaultAppMode === AppModeEnum.COMPLETION,
  )

  return (
    <>
      <div>
        <div className="flex flex-row gap-2">
          <AppTypeCard
            active={appMode === AppModeEnum.WORKFLOW}
            className={isBuilder ? 'w-auto flex-1' : undefined}
            title={t(($) => $['types.workflow'], { ns: 'app' })}
            description={t(($) => $['newApp.workflowShortDescription'], { ns: 'app' })}
            icon={
              <div className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-indigo-solid">
                <span
                  aria-hidden
                  className="i-ri-exchange-2-fill size-4 text-components-avatar-shape-fill-stop-100"
                />
              </div>
            }
            onClick={() => {
              onAppModeChange(AppModeEnum.WORKFLOW)
            }}
          />
          <AppTypeCard
            active={appMode === AppModeEnum.ADVANCED_CHAT}
            className={isBuilder ? 'w-auto flex-1' : undefined}
            title={t(($) => $['types.advanced'], { ns: 'app' })}
            description={t(($) => $['newApp.advancedShortDescription'], { ns: 'app' })}
            icon={
              <div className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-blue-light-solid">
                <span
                  aria-hidden
                  className="i-custom-vender-solid-communication-bubble-text-mod size-4 text-components-avatar-shape-fill-stop-100"
                />
              </div>
            }
            onClick={() => {
              onAppModeChange(AppModeEnum.ADVANCED_CHAT)
            }}
          />
        </div>
      </div>
      {!isBuilder && (
        <div>
          <div className="mb-2 flex items-center">
            <button
              type="button"
              className="flex cursor-pointer items-center border-0 bg-transparent p-0 text-left focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={() => setIsAppTypeExpanded(!isAppTypeExpanded)}
            >
              <span className="system-2xs-medium-uppercase text-text-tertiary">
                {t(($) => $['newApp.forBeginners'], { ns: 'app' })}
              </span>
              <span
                aria-hidden
                className={`ml-1 i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform ${isAppTypeExpanded ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
          {isAppTypeExpanded && (
            <div className="flex flex-row gap-2">
              <AppTypeCard
                active={appMode === AppModeEnum.CHAT}
                title={t(($) => $['types.chatbot'], { ns: 'app' })}
                description={t(($) => $['newApp.chatbotShortDescription'], { ns: 'app' })}
                icon={
                  <div className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
                    <span
                      aria-hidden
                      className="i-custom-vender-solid-communication-chat-bot size-4 text-components-avatar-shape-fill-stop-100"
                    />
                  </div>
                }
                onClick={() => {
                  onAppModeChange(AppModeEnum.CHAT)
                }}
              />
              <AppTypeCard
                active={appMode === AppModeEnum.AGENT_CHAT}
                title={t(($) => $['types.agent'], { ns: 'app' })}
                description={t(($) => $['newApp.agentShortDescription'], { ns: 'app' })}
                icon={
                  <div className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-violet-solid">
                    <span
                      aria-hidden
                      className="i-custom-vender-solid-communication-logic size-4 text-components-avatar-shape-fill-stop-100"
                    />
                  </div>
                }
                onClick={() => {
                  onAppModeChange(AppModeEnum.AGENT_CHAT)
                }}
              />
              <AppTypeCard
                active={appMode === AppModeEnum.COMPLETION}
                title={t(($) => $['newApp.completeApp'], { ns: 'app' })}
                description={t(($) => $['newApp.completionShortDescription'], {
                  ns: 'app',
                })}
                icon={
                  <div className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-teal-solid">
                    <span
                      aria-hidden
                      className="i-custom-vender-solid-communication-list-sparkle size-4 text-components-avatar-shape-fill-stop-100"
                    />
                  </div>
                }
                onClick={() => {
                  onAppModeChange(AppModeEnum.COMPLETION)
                }}
              />
            </div>
          )}
        </div>
      )}
    </>
  )
}

type AppTypeCardProps = {
  className?: string
  icon: React.JSX.Element
  title: string
  description: string
  active: boolean
  onClick: () => void
}
function AppTypeCard({ className, icon, title, description, active, onClick }: AppTypeCardProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'relative box-content h-21 w-47.75 cursor-pointer rounded-xl border-[0.5px] border-components-option-card-option-border bg-components-panel-on-panel-item-bg p-3 text-left shadow-xs outline-hidden hover:shadow-md focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        active
          ? 'shadow-md outline-[1.5px] outline-components-option-card-option-selected-border outline-solid'
          : '',
        className,
      )}
      onClick={onClick}
    >
      {icon}
      <div className="mt-2 mb-0.5 system-sm-semibold text-text-secondary">{title}</div>
      <div className="line-clamp-2 system-xs-regular text-text-tertiary" title={description}>
        {description}
      </div>
    </button>
  )
}
