import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from 'classnames'
import style from './style.module.css'
import Modal from '@/app/components/base/modal'
import useCopyToClipboard from '@/hooks/use-copy-to-clipboard'
import copyStyle from '@/app/components/app/chat/copy-btn/style.module.css'
import Tooltip from '@/app/components/base/tooltip'
import { useAppContext } from '@/context/app-context'

// const isDevelopment = process.env.NODE_ENV === 'development'

type Props = {
  isShow: boolean
  onClose: () => void
  accessToken: string
  appBaseUrl: string
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
    getContent: (url: string, token: string, isTestEnv?: boolean) =>
      `<script>
 window.difyChatbotConfig = { token: '${token}'${isTestEnv ? ', isDev: true' : ''} }
</script>
<script
 src="${url}/embed.min.js"
 id="${token}"
 defer>
</script>`,
  },
}
const prefixEmbedded = 'appOverview.overview.appInfo.embedded'

type Option = keyof typeof OPTION_MAP

const Embedded = ({ isShow, onClose, appBaseUrl, accessToken }: Props) => {
  const { t } = useTranslation()
  const [option, setOption] = useState<Option>('iframe')
  const [isCopied, setIsCopied] = useState({ iframe: false, scripts: false })
  const [_, copy] = useCopyToClipboard()

  const { langeniusVersionInfo } = useAppContext()
  const isTestEnv = langeniusVersionInfo.current_env === 'TESTING' || langeniusVersionInfo.current_env === 'DEVELOPMENT'
  const onClickCopy = () => {
    copy(OPTION_MAP[option].getContent(appBaseUrl, accessToken, isTestEnv))
    setIsCopied({ ...isCopied, [option]: true })
  }

  return (
    <Modal
      title={t(`${prefixEmbedded}.title`)}
      isShow={isShow}
      onClose={onClose}
      className="!max-w-2xl w-[640px]"
      closable={true}
    >
      <div className="mb-4 mt-8 text-gray-900 text-[14px] font-medium leading-tight">
        {t(`${prefixEmbedded}.explanation`)}
      </div>
      <div className="flex gap-4 items-center">
        {Object.keys(OPTION_MAP).map((v, index) => {
          return (
            <div
              key={index}
              className={cn(
                style.option,
                style[`${v}Icon`],
                option === v && style.active,
              )}
              onClick={() => setOption(v as Option)}
            ></div>
          )
        })}
      </div>
      <div className="mt-6 w-full bg-gray-100 rounded-lg flex-col justify-start items-start inline-flex">
        <div className="self-stretch pl-3 pr-1 py-1 bg-gray-50 rounded-tl-lg rounded-tr-lg border border-black border-opacity-5 justify-start items-center gap-2 inline-flex">
          <div className="grow shrink basis-0 text-slate-700 text-[13px] font-medium leading-none">
            {t(`${prefixEmbedded}.${option}`)}
          </div>
          <div className="p-2 rounded-lg justify-center items-center gap-1 flex">
            <Tooltip
              selector={'code-copy-feedback'}
              content={(isCopied[option] ? t(`${prefixEmbedded}.copied`) : t(`${prefixEmbedded}.copy`)) || ''}
            >
              <div className="w-8 h-8 cursor-pointer hover:bg-gray-100 rounded-lg">
                <div onClick={onClickCopy} className={`w-full h-full ${copyStyle.copyIcon} ${isCopied[option] ? copyStyle.copied : ''}`}></div>
              </div>
            </Tooltip>
          </div>
        </div>
        <div className="self-stretch p-3 justify-start items-start gap-2 inline-flex">
          <div className="grow shrink basis-0 text-slate-700 text-[13px] leading-tight font-mono">
            <pre className='select-text'>{OPTION_MAP[option].getContent(appBaseUrl, accessToken, isTestEnv)}</pre>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default Embedded
