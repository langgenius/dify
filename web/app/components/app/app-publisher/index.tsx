import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import dayjs from 'dayjs'
import classNames from 'classnames'
import type { ModelAndParameter } from '../configuration/debug/types'
import SuggestedAction from './suggested-action'
import PublishWithMultipleModel from './publish-with-multiple-model'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import Indicator from '@/app/components/header/indicator'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetLanguage } from '@/context/i18n'
import { ArrowUpRight, ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { PlayCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { Tools } from '@/app/components/base/icons/src/vender/line/others'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import { LeftIndent02 } from '@/app/components/base/icons/src/vender/line/editor'
import { FileText } from '@/app/components/base/icons/src/vender/line/files'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (modelAndParameter?: ModelAndParameter) => Promise<any> | any
  onRestore?: () => Promise<any> | any
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
}

const AppPublisher = ({
  disabled = false,
  publishDisabled = false,
  publishedAt,
  draftUpdatedAt,
  debugWithMultipleModel = false,
  multipleModelConfigs = [],
  onPublish,
  onRestore,
  onToggle,
  crossAxisOffset = 0,
}: AppPublisherProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const appDetail = useAppStore(state => state.appDetail)
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const appMode = (appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow') ? 'chat' : appDetail.mode
  const appURL = `${appBaseURL}/${appMode}/${accessToken}`

  const language = useGetLanguage()
  const formatTimeFromNow = useCallback((time: number) => {
    return dayjs(time).locale(language === 'zh_Hans' ? 'zh-cn' : language.replace('_', '-')).fromNow()
  }, [language])

  const handlePublish = async (modelAndParameter?: ModelAndParameter) => {
    try {
      await onPublish?.(modelAndParameter)
      setPublished(true)
    }
    catch (e) {
      setPublished(false)
    }
  }

  const handleRestore = useCallback(async () => {
    try {
      await onRestore?.()
      setOpen(false)
    }
    catch (e) { }
  }, [onRestore])

  const handleTrigger = useCallback(() => {
    const state = !open

    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(state)
    setOpen(state)

    if (state)
      setPublished(false)
  }, [disabled, onToggle, open])

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: crossAxisOffset,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTrigger}>
        <Button
          type='primary'
          className={`
            pl-3 pr-2 py-0 h-8 text-[13px] font-medium
            ${disabled && 'cursor-not-allowed opacity-50'}
          `}
        >
          {t('workflow.common.publish')}
          <ChevronDown className='ml-0.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <div className='w-[336px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl'>
          <div className='p-4 pt-3'>
            <div className='flex items-center h-6 text-xs font-medium text-gray-500 uppercase'>
              {publishedAt ? t('workflow.common.latestPublished') : t('workflow.common.currentDraftUnpublished')}
            </div>
            {publishedAt
              ? (
                <div className='flex justify-between items-center h-[18px]'>
                  <div className='flex items-center mt-[3px] mb-[3px] leading-[18px] text-[13px] font-medium text-gray-700'>
                    {t('workflow.common.publishedAt')} {formatTimeFromNow(publishedAt)}
                  </div>
                  <Button
                    className={`
                      ml-2 px-2 py-0 h-6 shadow-xs rounded-md text-xs font-medium text-primary-600 border-[0.5px] bg-white border-gray-200
                      ${published && 'text-primary-300 border-gray-100'}
                    `}
                    onClick={handleRestore}
                    disabled={published}
                  >
                    {t('workflow.common.restore')}
                  </Button>
                </div>
              )
              : (
                <div className='flex items-center h-[18px] leading-[18px] text-[13px] font-medium text-gray-700'>
                  {t('workflow.common.autoSaved')} · {Boolean(draftUpdatedAt) && formatTimeFromNow(draftUpdatedAt!)}
                </div>
              )}
            {debugWithMultipleModel
              ? (
                <PublishWithMultipleModel
                  multipleModelConfigs={multipleModelConfigs}
                  onSelect={item => handlePublish(item)}
                // textGenerationModelList={textGenerationModelList}
                />
              )
              : (
                <Button
                  type='primary'
                  className={classNames(
                    'mt-3 px-3 py-0 w-full h-8 border-[0.5px] border-primary-700 rounded-lg text-[13px] font-medium',
                    (publishDisabled || published) && 'border-transparent',
                  )}
                  onClick={() => handlePublish()}
                  disabled={publishDisabled || published}
                >
                  {
                    published
                      ? t('workflow.common.published')
                      : publishedAt ? t('workflow.common.update') : t('workflow.common.publish')
                  }
                </Button>
              )
            }
          </div>
          <div className='p-4 pt-3 border-t-[0.5px] border-t-black/5'>
            <SuggestedAction disabled={!publishedAt} link={appURL} icon={<PlayCircle />}>{t('workflow.common.runApp')}</SuggestedAction>
            {appDetail?.mode === 'workflow'
              ? (
                <SuggestedAction
                  disabled={!publishedAt}
                  link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`}
                  icon={<LeftIndent02 className='w-4 h-4' />}
                >
                  {t('workflow.common.batchRunApp')}
                </SuggestedAction>
              )
              : (
                <SuggestedAction
                  onClick={() => {
                    setEmbeddingModalOpen(true)
                    handleTrigger()
                  }}
                  disabled={!publishedAt}
                  icon={<CodeBrowser className='w-4 h-4' />}
                >
                  {t('workflow.common.embedIntoSite')}
                </SuggestedAction>
              )}
            <SuggestedAction disabled={!publishedAt} link='./develop' icon={<FileText className='w-4 h-4' />}>{t('workflow.common.accessAPIReference')}</SuggestedAction>
            {appDetail?.mode === 'workflow' && (
              <div className='mt-2 pt-2 border-t-[0.5px] border-t-black/5'>
                <div className={classNames(
                  'bg-gray-100 rounded-lg transition-colors',
                  !publishedAt ? 'shadow-xs opacity-30 cursor-not-allowed' : 'cursor-pointer',
                )}>
                  <div className='flex justify-start items-center gap-2 px-2.5 py-2' onClick={() => {}}>
                    <Tools className='relative w-4 h-4'/>
                    <div title={t('workflow.common.workflowAsTool') || ''} className='grow shrink basis-0 text-[13px] font-medium leading-[18px] truncate'>{t('workflow.common.workflowAsTool')}</div>
                    {!appDetail?.isTool && (
                      <span className='shrink-0 px-1 border border-black/8 rounded-[5px] bg-white text-[10px] font-medium leading-[18px] text-gray-500'>{t('workflow.common.configureRequired').toLocaleUpperCase()}</span>
                    )}
                  </div>
                  {appDetail?.isTool && (
                    <div className='px-2.5 py-2 border-t-[0.5px] border-black/5'>
                      <div className='flex justify-between'>
                        <Button
                          className='px-2 w-[140px] py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] bg-white border-gray-200'
                          onClick={() => {}}
                        >
                          {t('workflow.common.configure')}
                          <Indicator className='ml-1' color={'yellow'} />
                        </Button>
                        <Button
                          className='px-2 w-[140px] py-0 h-6 shadow-xs rounded-md text-xs font-medium text-gray-700 border-[0.5px] bg-white border-gray-200'
                          onClick={() => router.push('/tools')}
                        >
                          {t('workflow.common.manageInTools')}
                          <ArrowUpRight className='ml-1' />
                        </Button>
                      </div>
                      <div className='mt-1 text-xs leading-[18px] text-[#dc6803]'>{t('workflow.common.workflowAsToolTip')}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </PortalToFollowElemContent>
      <EmbeddedModal
        isShow={embeddingModalOpen}
        onClose={() => setEmbeddingModalOpen(false)}
        appBaseUrl={appBaseURL}
        accessToken={accessToken}
        className='z-50'
      />
    </PortalToFollowElem >
  )
}

export default memo(AppPublisher)
