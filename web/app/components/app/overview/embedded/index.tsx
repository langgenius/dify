import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import copy from 'copy-to-clipboard'
import style from './style.module.css'
import cn from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import copyStyle from '@/app/components/base/copy-btn/style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { useAppContext } from '@/context/app-context'
import { IS_CE_EDITION } from '@/config'
import type { SiteInfo } from '@/models/share'
import { useThemeContext } from '@/app/components/base/chat/embedded-chatbot/theme/theme-context'

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
  : ''}
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
      className="!max-w-2xl w-[640px]"
      wrapperClassName={className}
      closable={true}
    >
      <div className="mb-4 mt-8 text-gray-900 text-[14px] font-medium leading-tight">
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
        <div className="w-full mt-6">
          <div className={cn('gap-2 py-3 justify-center items-center inline-flex w-full rounded-lg',
            'bg-primary-600 hover:bg-primary-600/75 hover:shadow-md cursor-pointer text-white hover:shadow-sm flex-shrink-0')}>
            <div className={`w-4 h-4 relative ${style.pluginInstallIcon}`}></div>
            <div className="text-white text-sm font-medium font-['Inter'] leading-tight" onClick={navigateToChromeUrl}>{t(`${prefixEmbedded}.chromePlugin`)}</div>
          </div>
        </div>
      )}
      <div className={cn('w-full bg-gray-100 rounded-lg flex-col justify-start items-start inline-flex',
        'mt-6')}>
        <div className="inline-flex items-center self-stretch justify-start gap-2 py-1 pl-3 pr-1 border border-black rounded-tl-lg rounded-tr-lg bg-gray-50 border-opacity-5">
          <div className="grow shrink basis-0 text-slate-700 text-[13px] font-medium leading-none">
            {t(`${prefixEmbedded}.${option}`)}
          </div>
          <div className="flex items-center justify-center gap-1 p-2 rounded-lg">
            <Tooltip
              selector={'code-copy-feedback'}
              content={(isCopied[option] ? t(`${prefixEmbedded}.copied`) : t(`${prefixEmbedded}.copy`)) || ''}
            >
              <div className="w-8 h-8 rounded-lg cursor-pointer hover:bg-gray-100">
                <div onClick={onClickCopy} className={`w-full h-full ${copyStyle.copyIcon} ${isCopied[option] ? copyStyle.copied : ''}`}></div>
              </div>
            </Tooltip>
          </div>
        </div>
        <div className="flex items-start justify-start w-full gap-2 p-3 overflow-x-auto">
          <div className="grow shrink basis-0 text-slate-700 text-[13px] leading-tight font-mono">
            <pre className='select-text'>{OPTION_MAP[option].getContent(appBaseUrl, accessToken, themeBuilder.theme?.primaryColor ?? '#1C64F2', isTestEnv)}</pre>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default Embedded
