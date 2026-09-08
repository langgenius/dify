import { useTranslation } from 'react-i18next'
import useTheme from '@/hooks/use-theme'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'

export function AppPreview({ mode }: { mode: AppModeEnum }) {
  return (
    <div className="relative flex h-full flex-1 shrink justify-start overflow-hidden">
      <div className="absolute top-0 right-0 left-0 h-6 border-b border-b-divider-subtle 2xl:h-34.75"></div>
      <div className="max-w-190 border-x border-x-divider-subtle">
        <div className="h-6 2xl:h-34.75" />
        <AppPreviewInfo mode={mode} />
        <div className="absolute inset-x-0 border-b border-b-divider-subtle"></div>
        <div
          className="flex h-112 w-166 items-center justify-center"
          style={{
            background:
              'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(16,24,40,0.04) 4px,transparent 3px, transparent 6px)',
          }}
        >
          <AppScreenShot show={mode === AppModeEnum.CHAT} mode={AppModeEnum.CHAT} />
          <AppScreenShot
            show={mode === AppModeEnum.ADVANCED_CHAT}
            mode={AppModeEnum.ADVANCED_CHAT}
          />
          <AppScreenShot show={mode === AppModeEnum.AGENT_CHAT} mode={AppModeEnum.AGENT_CHAT} />
          <AppScreenShot show={mode === AppModeEnum.COMPLETION} mode={AppModeEnum.COMPLETION} />
          <AppScreenShot show={mode === AppModeEnum.WORKFLOW} mode={AppModeEnum.WORKFLOW} />
        </div>
        <div className="absolute inset-x-0 border-b border-b-divider-subtle"></div>
      </div>
    </div>
  )
}

function AppPreviewInfo({ mode }: { mode: AppModeEnum }) {
  const { t } = useTranslation()
  const previewInfo = (() => {
    switch (mode) {
      case AppModeEnum.CHAT:
        return {
          title: t(($) => $['types.chatbot'], { ns: 'app' }),
          description: t(($) => $['newApp.chatbotUserDescription'], { ns: 'app' }),
        }
      case AppModeEnum.ADVANCED_CHAT:
        return {
          title: t(($) => $['types.advanced'], { ns: 'app' }),
          description: t(($) => $['newApp.advancedUserDescription'], { ns: 'app' }),
        }
      case AppModeEnum.AGENT_CHAT:
        return {
          title: t(($) => $['types.agent'], { ns: 'app' }),
          description: t(($) => $['newApp.agentUserDescription'], { ns: 'app' }),
        }
      case AppModeEnum.COMPLETION:
        return {
          title: t(($) => $['newApp.completeApp'], { ns: 'app' }),
          description: t(($) => $['newApp.completionUserDescription'], { ns: 'app' }),
        }
      case AppModeEnum.WORKFLOW:
        return {
          title: t(($) => $['types.workflow'], { ns: 'app' }),
          description: t(($) => $['newApp.workflowUserDescription'], { ns: 'app' }),
        }
      default:
        return {
          title: t(($) => $['types.workflow'], { ns: 'app' }),
          description: t(($) => $['newApp.workflowUserDescription'], { ns: 'app' }),
        }
    }
  })()
  return (
    <div className="px-8 py-4">
      <h4 className="system-sm-semibold-uppercase text-text-secondary">{previewInfo.title}</h4>
      <div className="mt-1 min-h-8 max-w-96 system-xs-regular text-text-tertiary">
        <span>{previewInfo.description}</span>
      </div>
    </div>
  )
}

function AppScreenShot({ mode, show }: { mode: AppModeEnum; show: boolean }) {
  const { theme } = useTheme()
  const modeToImageMap = {
    [AppModeEnum.CHAT]: 'Chatbot',
    [AppModeEnum.ADVANCED_CHAT]: 'Chatflow',
    [AppModeEnum.AGENT_CHAT]: 'Agent',
    [AppModeEnum.COMPLETION]: 'TextGenerator',
    [AppModeEnum.WORKFLOW]: 'Workflow',
  }
  return (
    <picture>
      <source
        media="(resolution: 1x)"
        srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`}
      />
      <source
        media="(resolution: 2x)"
        srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@2x.png`}
      />
      <source
        media="(resolution: 3x)"
        srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@3x.png`}
      />
      <img
        className={show ? '' : 'hidden'}
        src={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`}
        alt="App Screen Shot"
        width={664}
        height={448}
      />
    </picture>
  )
}
