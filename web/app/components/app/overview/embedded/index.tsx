import type { SiteInfo } from '@/models/share'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useThemeContext } from '@/app/components/base/chat/embedded-chatbot/theme/theme-context'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { basePath } from '@/utils/var'
import style from './style.module.css'

type Props = {
  siteInfo?: SiteInfo
  isShow: boolean
  onClose: () => void
  accessToken: string
  appBaseUrl: string
  className?: string
}

const OPTION_MAP = {
  iframe: {
    getContent: (url: string, token: string) =>
      `<iframe
 src="${url}${basePath}/chatbot/${token}"
 style="width: 100%; height: 100%; min-height: 700px"
 frameborder="0"
 allow="microphone">
</iframe>`,
  },
  scripts: {
    getContent: (url: string, token: string, primaryColor: string, isTestEnv?: boolean) =>
      `<script>
 window.difyChatbotConfig = {
  token: '${token}'${isTestEnv
    ? `,
  isDev: true`
    : ''}${IS_CE_EDITION
    ? `,
  baseUrl: '${url}${basePath}'`
    : ''},
  inputs: {
    // You can define the inputs from the Start node here
    // key is the variable name
    // e.g.
    // name: "NAME"
  },
  systemVariables: {
    // user_id: 'YOU CAN DEFINE USER ID HERE',
    // conversation_id: 'YOU CAN DEFINE CONVERSATION ID HERE, IT MUST BE A VALID UUID',
  },
  userVariables: {
    // avatar_url: 'YOU CAN DEFINE USER AVATAR URL HERE',
    // name: 'YOU CAN DEFINE USER NAME HERE',
  },
 }
</script>
<script
 src="${url}${basePath}/embed.min.js"
 id="${token}"
 defer>
</script>
<style>
  #dify-chatbot-bubble-button {
    background-color: ${primaryColor} !important;
  }
  #dify-chatbot-bubble-window {
    width: 24rem !important;
    height: 40rem !important;
  }
</style>`,
  },
  chromePlugin: {
    getContent: (url: string, token: string) => `ChatBot URL: ${url}${basePath}/chatbot/${token}`,
  },
}
const prefixEmbedded = 'overview.appInfo.embedded'

type Option = keyof typeof OPTION_MAP

const OPTIONS: Option[] = ['iframe', 'scripts', 'chromePlugin']

const optionIconClassName: Record<Option, string> = {
  iframe: style.iframeIcon!,
  scripts: style.scriptsIcon!,
  chromePlugin: style.chromePluginIcon!,
}

const Embedded = ({ siteInfo, isShow, onClose, appBaseUrl, accessToken, className }: Props) => {
  const { t } = useTranslation()
  const [option, setOption] = useState<Option>('iframe')
  const [copiedOption, setCopiedOption] = useState<Option | null>(null)

  const { langGeniusVersionInfo } = useAppContext()
  const themeBuilder = useThemeContext()
  themeBuilder.buildTheme(siteInfo?.chat_color_theme ?? null, siteInfo?.chat_color_theme_inverted ?? false)
  const isTestEnv = langGeniusVersionInfo.current_env === 'TESTING' || langGeniusVersionInfo.current_env === 'DEVELOPMENT'
  const onClickCopy = () => {
    if (option === 'chromePlugin') {
      const splitUrl = OPTION_MAP[option].getContent(appBaseUrl, accessToken).split(': ')
      if (splitUrl.length > 1)
        copy(splitUrl[1]!)
    }
    else {
      copy(OPTION_MAP[option].getContent(appBaseUrl, accessToken, themeBuilder.theme?.primaryColor ?? '#1C64F2', isTestEnv))
    }
    setCopiedOption(option)
  }

  const navigateToChromeUrl = () => {
    window.open('https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf', '_blank', 'noopener,noreferrer')
  }

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (open)
          return
        setCopiedOption(null)
        onClose()
      }}
    >
      <DialogContent className={cn('max-h-[calc(100dvh-2rem)] w-[640px] overflow-visible', className)}>
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(`${prefixEmbedded}.title`, { ns: 'appOverview' })}
        </DialogTitle>
        <DialogCloseButton />
        <div className="mt-8 mb-4 system-sm-medium text-text-primary">
          {t(`${prefixEmbedded}.explanation`, { ns: 'appOverview' })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-y-2">
          {OPTIONS.map((v) => {
            return (
              <button
                type="button"
                key={v}
                aria-label={t(`${prefixEmbedded}.${v}`, { ns: 'appOverview' }) || v}
                className={cn(
                  style.option,
                  optionIconClassName[v],
                  option === v && style.active,
                )}
                onClick={() => {
                  setOption(v)
                  setCopiedOption(null)
                }}
              >
              </button>
            )
          })}
        </div>
        {option === 'chromePlugin' && (
          <div className="mt-6 w-full">
            <button
              type="button"
              className={cn('inline-flex w-full items-center justify-center gap-2 rounded-lg py-3', 'shrink-0 bg-primary-600 text-white hover:bg-primary-600/75 hover:shadow-sm')}
              onClick={navigateToChromeUrl}
            >
              <div className={`relative h-4 w-4 ${style.pluginInstallIcon}`}></div>
              <div className="font-['Inter'] text-sm leading-tight font-medium text-white">{t(`${prefixEmbedded}.chromePlugin`, { ns: 'appOverview' })}</div>
            </button>
          </div>
        )}
        <div className={cn('inline-flex w-full flex-col items-start justify-start rounded-lg border-[0.5px] border-components-panel-border bg-background-section', 'mt-6')}>
          <div className="inline-flex items-center justify-start gap-2 self-stretch rounded-t-lg bg-background-section-burn py-1 pr-1 pl-3">
            <div className="shrink-0 grow system-sm-medium text-text-secondary">
              {t(`${prefixEmbedded}.${option}`, { ns: 'appOverview' })}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <ActionButton
                    aria-label={(copiedOption === option
                      ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
                      : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''}
                    onClick={onClickCopy}
                  >
                    {copiedOption === option && <span aria-hidden="true" className="i-ri-clipboard-fill h-4 w-4" />}
                    {copiedOption !== option && <span aria-hidden="true" className="i-ri-clipboard-line h-4 w-4" />}
                  </ActionButton>
                )}
              />
              <TooltipContent>
                {(copiedOption === option
                  ? t(`${prefixEmbedded}.copied`, { ns: 'appOverview' })
                  : t(`${prefixEmbedded}.copy`, { ns: 'appOverview' })) || ''}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex max-h-[clamp(180px,calc(100dvh-320px),360px)] w-full items-start justify-start gap-2 overflow-auto p-3">
            <div className="shrink grow basis-0 font-mono text-[13px] leading-tight text-text-secondary">
              <pre className="select-text">{OPTION_MAP[option].getContent(appBaseUrl, accessToken, themeBuilder.theme?.primaryColor ?? '#1C64F2', isTestEnv)}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default Embedded
