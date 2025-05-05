import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import {
  RiArrowDownSLine,
  RiPlanetLine,
  RiPlayCircleLine,
  RiPlayList2Line,
  RiTerminalBoxLine,
} from '@remixicon/react'
import { useKeyPress } from 'ahooks'
import Toast from '../../base/toast'
import type { ModelAndParameter } from '../configuration/debug/types'
import { getKeyboardKeyCodeBySystem } from '../../workflow/utils'
import SuggestedAction from './suggested-action'
import PublishWithMultipleModel from './publish-with-multiple-model'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { basePath } from '@/utils/var'
import { fetchInstalledAppList } from '@/service/explore'
import EmbeddedModal from '@/app/components/app/overview/embedded'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useGetLanguage } from '@/context/i18n'
import { CodeBrowser } from '@/app/components/base/icons/src/vender/line/development'
import WorkflowToolConfigureButton from '@/app/components/tools/workflow-tool/configure-button'
import type { InputVar } from '@/app/components/workflow/types'
import { appDefaultIconBackground } from '@/config'
import type { PublishWorkflowParams } from '@/types/workflow'

export type AppPublisherProps = {
  disabled?: boolean
  publishDisabled?: boolean
  publishedAt?: number
  /** only needed in workflow / chatflow mode */
  draftUpdatedAt?: number
  debugWithMultipleModel?: boolean
  multipleModelConfigs?: ModelAndParameter[]
  /** modelAndParameter is passed when debugWithMultipleModel is true */
  onPublish?: (params?: any) => Promise<any> | any
  onRestore?: () => Promise<any> | any
  onToggle?: (state: boolean) => void
  crossAxisOffset?: number
  toolPublished?: boolean
  inputs?: InputVar[]
  onRefreshData?: () => void
}

const PUBLISH_SHORTCUT = ['⌘', '⇧', 'P']

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
  toolPublished,
  inputs,
  onRefreshData,
}: AppPublisherProps) => {
  const { t } = useTranslation()
  const [published, setPublished] = useState(false)
  const [open, setOpen] = useState(false)
  const appDetail = useAppStore(state => state.appDetail)
  const { app_base_url: appBaseURL = '', access_token: accessToken = '' } = appDetail?.site ?? {}
  const appMode = (appDetail?.mode !== 'completion' && appDetail?.mode !== 'workflow') ? 'chat' : appDetail.mode
  const appURL = `${appBaseURL}${basePath}/${appMode}/${accessToken}`
  const isChatApp = ['chat', 'agent-chat', 'completion'].includes(appDetail?.mode || '')

  const language = useGetLanguage()
  const formatTimeFromNow = useCallback((time: number) => {
    return dayjs(time).locale(language === 'zh_Hans' ? 'zh-cn' : language.replace('_', '-')).fromNow()
  }, [language])

  const handlePublish = useCallback(async (params?: ModelAndParameter | PublishWorkflowParams) => {
    try {
      await onPublish?.(params)
      setPublished(true)
    }
    catch {
      setPublished(false)
    }
  }, [onPublish])

  const handleRestore = useCallback(async () => {
    try {
      await onRestore?.()
      setOpen(false)
    }
    catch {}
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

  const handleOpenInExplore = useCallback(async () => {
    try {
      const { installed_apps }: any = await fetchInstalledAppList(appDetail?.id) || {}
      if (installed_apps?.length > 0)
        window.open(`${basePath}/explore/installed/${installed_apps[0].id}`, '_blank')
      else
        throw new Error('No app found in Explore')
    }
    catch (e: any) {
      Toast.notify({ type: 'error', message: `${e.message || e}` })
    }
  }, [appDetail?.id])

  const [embeddingModalOpen, setEmbeddingModalOpen] = useState(false)

  useKeyPress(`${getKeyboardKeyCodeBySystem('ctrl')}.shift.p`, (e) => {
    e.preventDefault()
    if (publishDisabled || published)
      return
    handlePublish()
  },
  { exactMatch: true, useCapture: true })

  return (
    <>
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
            variant='primary'
            className='p-2'
            disabled={disabled}
          >
            {t('workflow.common.publish')}
            <RiArrowDownSLine className='h-4 w-4 text-components-button-primary-text' />
          </Button>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[11]'>
          <div className='w-[320px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl shadow-shadow-shadow-5'>
            <div className='p-4 pt-3'>
              <div className='system-xs-medium-uppercase flex h-6 items-center text-text-tertiary'>
                {publishedAt ? t('workflow.common.latestPublished') : t('workflow.common.currentDraftUnpublished')}
              </div>
              {publishedAt
                ? (
                  <div className='flex items-center justify-between'>
                    <div className='system-sm-medium flex items-center text-text-secondary'>
                      {t('workflow.common.publishedAt')} {formatTimeFromNow(publishedAt)}
                    </div>
                    {isChatApp && <Button
                      variant='secondary-accent'
                      size='small'
                      onClick={handleRestore}
                      disabled={published}
                    >
                      {t('workflow.common.restore')}
                    </Button>}
                  </div>
                )
                : (
                  <div className='system-sm-medium flex items-center text-text-secondary'>
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
                    variant='primary'
                    className='mt-3 w-full'
                    onClick={() => handlePublish()}
                    disabled={publishDisabled || published}
                  >
                    {
                      published
                        ? t('workflow.common.published')
                        : (
                          <div className='flex gap-1'>
                            <span>{t('workflow.common.publishUpdate')}</span>
                            <div className='flex gap-0.5'>
                              {PUBLISH_SHORTCUT.map(key => (
                                <span key={key} className='system-kbd h-4 w-4 rounded-[4px] bg-components-kbd-bg-white text-text-primary-on-surface'>
                                  {key}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                    }
                  </Button>
                )
              }
            </div>
            <div className='border-t-[0.5px] border-t-divider-regular p-4 pt-3'>
              <SuggestedAction
                disabled={!publishedAt}
                link={appURL}
                icon={<RiPlayCircleLine className='h-4 w-4' />}
              >
                {t('workflow.common.runApp')}
              </SuggestedAction>
              {appDetail?.mode === 'workflow' || appDetail?.mode === 'completion'
                ? (
                  <SuggestedAction
                    disabled={!publishedAt}
                    link={`${appURL}${appURL.includes('?') ? '&' : '?'}mode=batch`}
                    icon={<RiPlayList2Line className='h-4 w-4' />}
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
                    icon={<CodeBrowser className='h-4 w-4' />}
                  >
                    {t('workflow.common.embedIntoSite')}
                  </SuggestedAction>
                )}
              <SuggestedAction
                onClick={() => {
                  publishedAt && handleOpenInExplore()
                }}
                disabled={!publishedAt}
                icon={<RiPlanetLine className='h-4 w-4' />}
              >
                {t('workflow.common.openInExplore')}
              </SuggestedAction>
              <SuggestedAction
                disabled={!publishedAt}
                link='./develop'
                icon={<RiTerminalBoxLine className='h-4 w-4' />}
              >
                {t('workflow.common.accessAPIReference')}
              </SuggestedAction>
              {appDetail?.mode === 'workflow' && (
                <WorkflowToolConfigureButton
                  disabled={!publishedAt}
                  published={!!toolPublished}
                  detailNeedUpdate={!!toolPublished && published}
                  workflowAppId={appDetail?.id}
                  icon={{
                    content: (appDetail.icon_type === 'image' ? '🤖' : appDetail?.icon) || '🤖',
                    background: (appDetail.icon_type === 'image' ? appDefaultIconBackground : appDetail?.icon_background) || appDefaultIconBackground,
                  }}
                  name={appDetail?.name}
                  description={appDetail?.description}
                  inputs={inputs}
                  handlePublish={handlePublish}
                  onRefreshData={onRefreshData}
                />
              )}
            </div>
          </div>
        </PortalToFollowElemContent>
        <EmbeddedModal
          siteInfo={appDetail?.site}
          isShow={embeddingModalOpen}
          onClose={() => setEmbeddingModalOpen(false)}
          appBaseUrl={appBaseURL}
          accessToken={accessToken}
        />
      </PortalToFollowElem >
    </>
  )
}

export default memo(AppPublisher)
