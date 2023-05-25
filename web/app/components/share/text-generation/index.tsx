'use client'
import React, { FC, useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import cn from 'classnames'
import { useBoolean, useClickAway } from 'ahooks'
import { useContext } from 'use-context-selector'
import ConfigScence from '@/app/components/share/text-generation/config-scence'
import NoData from '@/app/components/share/text-generation/no-data'
// import History from '@/app/components/share/text-generation/history'
import { fetchAppInfo, fetchAppParams, sendCompletionMessage, updateFeedback, saveMessage, fetchSavedMessage as doFetchSavedMessage, removeMessage } from '@/service/share'
import type { SiteInfo } from '@/models/share'
import type { PromptConfig, MoreLikeThisConfig, SavedMessage } from '@/models/debug'
import Toast from '@/app/components/base/toast'
import { Feedbacktype } from '@/app/components/app/chat'
import { changeLanguage } from '@/i18n/i18next-config'
import Loading from '@/app/components/base/loading'
import { userInputsFormToPromptVariables } from '@/utils/model-config'
import TextGenerationRes from '@/app/components/app/text-generate/item'
import SavedItems from '@/app/components/app/text-generate/saved-items'
import TabHeader from '../../base/tab-header'
import { XMarkIcon } from '@heroicons/react/24/outline'
import s from './style.module.css'
import Button from '../../base/button'
import { App } from '@/types/app'
import { InstalledApp } from '@/models/explore'

export type IMainProps = {
  isInstalledApp?: boolean,
  installedAppInfo? : InstalledApp
}

const TextGeneration: FC<IMainProps> = ({
  isInstalledApp = false,
  installedAppInfo
}) => {
  const { t } = useTranslation()
  const media = useBreakpoints()
  const isPC = media === MediaType.pc
  const isTablet = media === MediaType.tablet
  const isMoble = media === MediaType.mobile

  const [currTab, setCurrTab] = useState<string>('create')

  const [inputs, setInputs] = useState<Record<string, any>>({})
  const [appId, setAppId] = useState<string>('')
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null)
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null)
  const [moreLikeThisConifg, setMoreLikeThisConifg] = useState<MoreLikeThisConfig | null>(null)
  const [isResponsing, { setTrue: setResponsingTrue, setFalse: setResponsingFalse }] = useBoolean(false)
  const [query, setQuery] = useState('')
  const [completionRes, setCompletionRes] = useState('')
  const { notify } = Toast
  const isNoData = !completionRes

  const [messageId, setMessageId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedbacktype>({
    rating: null
  })

  const handleFeedback = async (feedback: Feedbacktype) => {
    await updateFeedback({ url: `/messages/${messageId}/feedbacks`, body: { rating: feedback.rating } }, isInstalledApp, installedAppInfo?.id)
    setFeedback(feedback)
  }

  const [savedMessages, setSavedMessages] = useState<SavedMessage[]>([])

  const fetchSavedMessage = async () => {
    const res: any = await doFetchSavedMessage(isInstalledApp, installedAppInfo?.id)
    setSavedMessages(res.data)
  }

  useEffect(() => {
    fetchSavedMessage()
  }, [])

  const handleSaveMessage = async (messageId: string) => {
    await saveMessage(messageId, isInstalledApp, installedAppInfo?.id)
    notify({ type: 'success', message: t('common.api.saved') })
    fetchSavedMessage()
  }

  const handleRemoveSavedMessage = async (messageId: string) => {
    await removeMessage(messageId, isInstalledApp, installedAppInfo?.id)
    notify({ type: 'success', message: t('common.api.remove') })
    fetchSavedMessage()
  }

  const logError = (message: string) => {
    notify({ type: 'error', message })
  }

  const checkCanSend = () => {
    const prompt_variables = promptConfig?.prompt_variables
    if (!prompt_variables || prompt_variables?.length === 0) {
      return true
    }
    let hasEmptyInput = false
    const requiredVars = prompt_variables?.filter(({ key, name, required }) => {
      const res = (!key || !key.trim()) || (!name || !name.trim()) || (required || required === undefined || required === null)
      return res
    }) || [] // compatible with old version
    requiredVars.forEach(({ key }) => {
      if (hasEmptyInput) {
        return
      }
      if (!inputs[key]) {
        hasEmptyInput = true
      }
    })

    if (hasEmptyInput) {
      logError(t('appDebug.errorMessage.valueOfVarRequired'))
      return false
    }
    return !hasEmptyInput
  }

  const handleSend = async () => {
    if (isResponsing) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForResponse') })
      return false
    }

    if (!checkCanSend())
      return

    if (!query) {
      logError(t('appDebug.errorMessage.queryRequired'))
      return false
    }

    const data = {
      inputs,
      query,
    }

    setMessageId(null)
    setFeedback({
      rating: null
    })
    setCompletionRes('')

    const res: string[] = []
    let tempMessageId = ''

    if (!isPC) {
      showResSidebar()
    }
    setResponsingTrue()
    sendCompletionMessage(data, {
      onData: (data: string, _isFirstMessage: boolean, { messageId }: any) => {
        tempMessageId = messageId
        res.push(data)
        setCompletionRes(res.join(''))
      },
      onCompleted: () => {
        setResponsingFalse()
        setMessageId(tempMessageId)
      },
      onError() {
        setResponsingFalse()
      }
    }, isInstalledApp, installedAppInfo?.id)
  }

  const fetchInitData = () => {
    return Promise.all([isInstalledApp ? {
      app_id: installedAppInfo?.id, 
      site: {
        title: installedAppInfo?.app.name,
        prompt_public: false,
        copyright: ''
      },
      plan: 'basic',
    }: fetchAppInfo(), fetchAppParams(isInstalledApp, installedAppInfo?.id)])
  }

  useEffect(() => {
    (async () => {
      const [appData, appParams]: any = await fetchInitData()
      const { app_id: appId, site: siteInfo } = appData
      setAppId(appId)
      setSiteInfo(siteInfo as SiteInfo)
      changeLanguage(siteInfo.default_language)

      const { user_input_form, more_like_this }: any = appParams
      const prompt_variables = userInputsFormToPromptVariables(user_input_form)
      setPromptConfig({
        prompt_template: '', // placeholder for feture
        prompt_variables,
      } as PromptConfig)
      setMoreLikeThisConifg(more_like_this)
    })()
  }, [])

  // Can Use metadata(https://beta.nextjs.org/docs/api-reference/metadata) to set title. But it only works in server side client. 
  useEffect(() => {
    if (siteInfo?.title)
      document.title = `${siteInfo.title} - Powered by Dify`
  }, [siteInfo?.title])

  const [isShowResSidebar, { setTrue: showResSidebar, setFalse: hideResSidebar }] = useBoolean(false)
  const resRef = useRef<HTMLDivElement>(null)
  useClickAway(() => {
    hideResSidebar();
  }, resRef)

  const renderRes = (
    <div
      ref={resRef}
      className={
        cn(
          "flex flex-col h-full shrink-0",
          isPC ? 'px-10 py-8' : 'bg-gray-50',
          isTablet && 'p-6', isMoble && 'p-4')
        }
    >
      <>
        <div className='shrink-0 flex items-center justify-between'>
          <div className='flex items-center space-x-3'>
            <div className={s.starIcon}></div>
            <div className='text-lg text-gray-800 font-semibold'>{t('share.generation.title')}</div>
          </div>
          {!isPC && (
            <div
              className='flex items-center justify-center cursor-pointer'
              onClick={hideResSidebar}
            >
              <XMarkIcon className='w-4 h-4 text-gray-800' />
            </div>
          )}
        </div>

        <div className='grow'>
          {(isResponsing && !completionRes) ? (
            <div className='flex h-full w-full justify-center items-center'>
              <Loading type='area' />
            </div>) : (
            <>
              {isNoData
                ? <NoData />
                : (
                  <TextGenerationRes
                    className='mt-3'
                    content={completionRes}
                    messageId={messageId}
                    isInWebApp
                    moreLikeThis={moreLikeThisConifg?.enabled}
                    onFeedback={handleFeedback}
                    feedback={feedback}
                    onSave={handleSaveMessage}
                    isMobile={isMoble}
                    isInstalledApp={isInstalledApp}
                    installedAppId={installedAppInfo?.id}
                  />
                )
              }
            </>
          )}
        </div>
      </>
    </div>
  )

  if (!appId || !siteInfo || !promptConfig)
    return <Loading type='app' />


  return (
    <>
      <div className={cn(
        isPC && 'flex',
        isInstalledApp ? s.installedApp : 'h-screen',
        'bg-gray-50'
      )}>
        {/* Left */}
        <div className={cn(
          isPC ? 'w-[600px] max-w-[50%] p-8' : 'p-4',
          isInstalledApp && 'rounded-l-2xl',
          "shrink-0 relative flex flex-col pb-10 h-full border-r border-gray-100 bg-white"
        )}>
          <div className='mb-6'>
            <div className='flex justify-between items-center'>
              <div className='flex items-center space-x-3'>
                <div className={cn(s.appIcon, 'shrink-0')}></div>
                <div className='text-lg text-gray-800 font-semibold'>{siteInfo.title}</div>
              </div>
              {!isPC && (
                <Button
                  className='shrink-0 !h-8 !px-3 ml-2'
                  onClick={showResSidebar}
                >
                  <div className='flex items-center space-x-2 text-primary-600 text-[13px] font-medium'>
                    <div className={s.starIcon}></div>
                    <span>{t('share.generation.title')}</span>
                  </div>
                </Button>
              )}
            </div>
            {siteInfo.description && (
              <div className='mt-2 text-xs text-gray-500'>{siteInfo.description}</div>
            )}
          </div>
          <TabHeader
            items={[
              { id: 'create', name: t('share.generation.tabs.create') },
              {
                id: 'saved', name: t('share.generation.tabs.saved'), extra: savedMessages.length > 0 ? (
                  <div className='ml-1 flext items-center h-5 px-1.5 rounded-md border border-gray-200 text-gray-500 text-xs font-medium'>
                    {savedMessages.length}
                  </div>
                ) : null
              }
            ]}
            value={currTab}
            onChange={setCurrTab}
          />
          <div className='grow h-20 overflow-y-auto'>
            {currTab === 'create' && (
              <ConfigScence
                siteInfo={siteInfo}
                inputs={inputs}
                onInputsChange={setInputs}
                promptConfig={promptConfig}
                query={query}
                onQueryChange={setQuery}
                onSend={handleSend}
              />
            )}

            {currTab === 'saved' && (
              <SavedItems
                className='mt-4'
                list={savedMessages}
                onRemove={handleRemoveSavedMessage}
                onStartCreateContent={() => setCurrTab('create')}
              />
            )}
          </div>


          {/* copyright */}
          <div className={cn(
            isInstalledApp ? 'left-[248px]' : 'left-8',
            'fixed  bottom-4  flex space-x-2 text-gray-400 font-normal text-xs'
            )}>
            <div className="">© {siteInfo.copyright || siteInfo.title} {(new Date()).getFullYear()}</div>
            {siteInfo.privacy_policy && (
              <>
                <div>·</div>
                <div>{t('share.chat.privacyPolicyLeft')}
                  <a
                    className='text-gray-500'
                    href={siteInfo.privacy_policy}
                    target='_blank'>{t('share.chat.privacyPolicyMiddle')}</a>
                  {t('share.chat.privacyPolicyRight')}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Result */}
        {isPC && (
          <div className='grow h-full'>
            {renderRes}
          </div>
        )}

        {(!isPC && isShowResSidebar) && (
          <div
            className={cn('fixed z-50 inset-0', isTablet ? 'pl-[128px]' : 'pl-6')}
            style={{
              background: 'rgba(35, 56, 118, 0.2)'
            }}
          >
            {renderRes}
          </div>
        )}
      </div>
    </>
  )
}

export default TextGeneration
