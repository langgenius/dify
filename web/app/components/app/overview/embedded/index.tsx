import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiClipboardFill,
  RiClipboardLine,
} from '@remixicon/react'
import copy from 'copy-to-clipboard'
import style from './style.module.css'
import Modal from '@/app/components/base/modal'
import Tooltip from '@/app/components/base/tooltip'
import { useAppContext } from '@/context/app-context'
import { IS_CE_EDITION } from '@/config'
import type { SiteInfo } from '@/models/share'
import { useThemeContext } from '@/app/components/base/chat/embedded-chatbot/theme/theme-context'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

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
 src="${url}/chatbot/${token}"
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
  baseUrl: '${url}'`
    : ''},
  systemVariables: {
    // user_id: 'YOU CAN DEFINE USER ID HERE',
  },
 }
</script>
<script
 src="${url}/embed.min.js"
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
    getContent: (url: string, token: string) => `ChatBot URL: ${url}/chatbot/${token}`,
  },
}
const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

type Option = keyof typeof OPTION_MAP

type OptionStatus = {
  iframe: boolean
  scripts: boolean
  chromePlugin: boolean
}

const Embedded = ({ siteInfo, isShow, onClose, appBaseUrl, accessToken, className }: Props) => {
  const { t } = useTranslation()
  const [option, setOption] = useState<Option>('iframe')
  const [isCopied, setIsCopied] = useState<OptionStatus>({ iframe: false, scripts: false, chromePlugin: false })

  const { langeniusVersionInfo } = useAppContext()
  const themeBuilder = useThemeContext()
  themeBuilder.buildTheme(siteInfo?.chat_color_theme ?? null, siteInfo?.chat_color_theme_inverted ?? false)
  const isTestEnv = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const onClickCopy = () => {
    if (option === 'chromePlugin') {
      const splitUrl = OPTION_MAP[option].getContent(appBaseUrl, accessToken).split(': ')
      if (splitUrl.length > 1)
        copy(splitUrl[1])
    }
    else {
      copy(OPTION_MAP[option].getContent(appBaseUrl, accessToken, themeBuilder.theme?.primaryColor ?? '#1C64F2', isTestEnv))
    }
    setIsCopied({ ...isCopied, [option]: true })
  }

  // when toggle option, reset then copy status
  const resetCopyStatus = () => {
    const cache = { ...isCopied }
    Object.keys(cache).forEach((key) => {
      cache[key as keyof OptionStatus] = false
    })
    setIsCopied(cache)
  }

  const navigateToChromeUrl = () => {
    window.open('https://chrome.google.com/webstore/detail/dify-chatbot/ceehdapohffmjmkdcifjofadiaoeggaf', '_blank')
  }

  useEffect(() => {
    resetCopyStatus()
  }, [isShow])

  return (
    <Modal
      title={t(`${prefixEmbedded}.title`)}
      isShow={isShow}
      onClose={onClose}
      className="w-[640px] !max-w-2xl"
      wrapperClassName={className}
      closable={true}
    >
      <div className="system-sm-medium mb-4 mt-8 text-text-primary">
        {t(`${prefixEmbedded}.explanation`)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-y-2">
        {Object.keys(OPTION_MAP).map((v, index) => {
          return (
            <div
              key={index}
              className={cn(
                style.option,
                style[`${v}Icon`],
                option === v && style.active,
              )}
              onClick={() => {
                setOption(v as Option)
                resetCopyStatus()
              }}
            ></div>
          )
        })}
      </div>
      {option === 'chromePlugin' && (
        <div className="mt-6 w-full">
          <div className={cn('inline-flex w-full items-center justify-center gap-2 rounded-lg py-3',
            'shrink-0 cursor-pointer bg-primary-600 text-white hover:bg-primary-600/75 hover:shadow-sm')}>
            <div className={`relative h-4 w-4 ${style.pluginInstallIcon}`}></div>
            <div className="font-['Inter'] text-sm font-medium leading-tight text-white" onClick={navigateToChromeUrl}>{t(`${prefixEmbedded}.chromePlugin`)}</div>
          </div>
        </div>
      )}
      <div className={cn('inline-flex w-full flex-col items-start justify-start rounded-lg border-[0.5px] border-components-panel-border bg-background-section',
        'mt-6')}>
        <div className="inline-flex items-center justify-start gap-2 self-stretch rounded-t-lg bg-background-section-burn py-1  pl-3 pr-1">
          <div className="system-sm-medium shrink-0 grow text-text-secondary">
            {t(`${prefixEmbedded}.${option}`)}
          </div>
          <Tooltip
            popupContent={
              (isCopied[option]
                ? t(`${prefixEmbedded}.copied`)
                : t(`${prefixEmbedded}.copy`)) || ''
            }
          >
            <ActionButton>
              <div
                onClick={onClickCopy}
              >
                {isCopied[option] && <RiClipboardFill className='h-4 w-4' />}
                {!isCopied[option] && <RiClipboardLine className='h-4 w-4' />}
              </div>
            </ActionButton>
          </Tooltip>
        </div>
        <div className="flex w-full items-start justify-start gap-2 overflow-x-auto p-3">
          <div className="shrink grow basis-0 font-mono text-[13px] leading-tight text-text-secondary">
            <pre className='select-text'>{OPTION_MAP[option].getContent(appBaseUrl, accessToken, themeBuilder.theme?.primaryColor ?? '#1C64F2', isTestEnv)}</pre>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default Embedded
