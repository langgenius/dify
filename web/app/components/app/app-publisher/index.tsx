import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import SuggestedAction from './suggested-action'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { PlayCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import { LeftIndent02 } from '@/app/components/base/icons/src/vender/line/editor'
import { FileText } from '@/app/components/base/icons/src/vender/line/files'
import { useGetLanguage } from '@/context/i18n'

export type AppPublisherProps = {
  disabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  onPublish?: () => Promise<void> | void
  onRestore?: () => Promise<void> | void
  onToggle?: (state: boolean) => void
}

const AppPublisher = ({
  disabled = false,
  publishedAt,
  draftUpdatedAt,
  onPublish,
  onRestore,
  onToggle,
}: AppPublisherProps) => {
  const { t } = useTranslation()
  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const appDetail = useAppStore(state => state.appDetail)
  const { app_base_url: appBaseURL, access_token } = appDetail?.site ?? {}
  const appMode = (appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow') ? 'chat' : appDetail.mode
  const appURL = `${appBaseURL}/${appMode}/${access_token}`

  const language = useGetLanguage()
  const formatTimeFromNow = useCallback((time: number) => {
    return dayjs(time).locale(language === 'zh_Hans' ? 'zh-cn' : language.replace('_', '-')).fromNow()
  }, [language])

  const handlePublish = async () => {
    try {
      await onPublish?.()
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
    if (disabled) {
      setOpen(false)
      return
    }

    onToggle?.(!open)

    if (open) {
      setOpen(false)
    }
    else {
      setOpen(true)
      setPublished(false)
    }
  }, [disabled, onToggle, open])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -5,
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
        <div className='w-[320px] bg-white rounded-2xl border-[0.5px] border-gray-200 shadow-xl'>
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
            <Button
              type='primary'
              className={`
                mt-3 px-3 py-0 w-full h-8 border-[0.5px] border-primary-700 rounded-lg text-[13px] font-medium
                ${published && 'border-transparent'}
              `}
              onClick={handlePublish}
              disabled={published}
            >
              {
                published
                  ? t('workflow.common.published')
                  : publishedAt ? t('workflow.common.update') : t('workflow.common.publish')
              }
            </Button>
          </div>
          <div className='p-4 pt-3 border-t-[0.5px] border-t-black/5'>
            <SuggestedAction disabled={!publishedAt} link={appURL} icon={<PlayCircle />}>{t('workflow.common.runApp')}</SuggestedAction>
            {appMode === 'chat'
              ? (
                <SuggestedAction disabled={!publishedAt} link={appURL} icon={<CodeBrowser className='w-4 h-4' />}>{t('workflow.common.embedIntoSite')}</SuggestedAction>
              )
              : (
                <SuggestedAction disabled={!publishedAt} link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`} icon={<LeftIndent02 className='w-4 h-4' />}>{t('workflow.common.batchRunApp')}</SuggestedAction>
              )}
            <SuggestedAction disabled={!publishedAt} link='./develop' icon={<FileText className='w-4 h-4' />}>{t('workflow.common.accessAPIReference')}</SuggestedAction>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem >
  )
}

export default memo(AppPublisher)
