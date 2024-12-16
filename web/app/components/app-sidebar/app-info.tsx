import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import { RiArrowDownSLine } from '@remixicon/react'
import React, { useCallback, useState } from 'react'
import AppIcon from '../base/app-icon'
import SwitchAppModal from '../app/switch-app-modal'
import s from './style.module.css'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Divider from '@/app/components/base/divider'
import Confirm from '@/app/components/base/confirm'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import AppsContext, { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { copyApp, deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import DuplicateAppModal from '@/app/components/app/duplicate-modal'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import { AiText, ChatBot, CuteRobot } from '@/app/components/base/icons/src/vender/solid/communication'
import { Route } from '@/app/components/base/icons/src/vender/solid/mapsAndTravel'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import DSLExportConfirmModal from '@/app/components/workflow/dsl-export-confirm-modal'
import { fetchWorkflowDraft } from '@/service/workflow'

export type IAppInfoProps = {
  expand: boolean
}

const AppInfo = ({ expand }: IAppInfoProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { replace } = useRouter()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const [open, setOpen] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showSwitchTip, setShowSwitchTip] = useState<string>('')
  const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
  const [showImportDSLModal, setShowImportDSLModal] = useState<boolean>(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])

  const mutateApps = useContextSelector(
    AppsContext,
    state => state.mutateApps,
  )

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
  }) => {
    if (!appDetail)
      return
    try {
      const app = await updateAppInfo({
        appID: appDetail.id,
        name,
        icon_type,
        icon,
        icon_background,
        description,
        use_icon_as_answer_icon,
      })
      setShowEditModal(false)
      notify({
        type: 'success',
        message: t('app.editDone'),
      })
      setAppDetail(app)
      mutateApps()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.editFailed') })
    }
  }, [appDetail, mutateApps, notify, setAppDetail, t])

  const onCopy: DuplicateAppModalProps['onConfirm'] = async ({ name, icon_type, icon, icon_background }) => {
    if (!appDetail)
      return
    try {
      const newApp = await copyApp({
        appID: appDetail.id,
        name,
        icon_type,
        icon,
        icon_background,
        mode: appDetail.mode,
      })
      setShowDuplicateModal(false)
      notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      mutateApps()
      onPlanInfoChanged()
      getRedirection(true, newApp, replace)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  const onExport = async (include = false) => {
    if (!appDetail)
      return
    try {
      const { data } = await exportAppConfig({
        appID: appDetail.id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      a.href = URL.createObjectURL(file)
      a.download = `${appDetail.name}.yml`
      a.click()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }

  const exportCheck = async () => {
    if (!appDetail)
      return
    if (appDetail.mode !== 'workflow' && appDetail.mode !== 'advanced-chat') {
      onExport()
      return
    }
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${appDetail.id}/workflows/draft`)
      const list = (workflowDraft.environment_variables || []).filter(env => env.value_type === 'secret')
      if (list.length === 0) {
        onExport()
        return
      }
      setSecretEnvList(list)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail)
      return
    try {
      await deleteApp(appDetail.id)
      notify({ type: 'success', message: t('app.appDeleted') })
      mutateApps()
      onPlanInfoChanged()
      setAppDetail()
      replace('/apps')
    }
    catch (e: any) {
      notify({
        type: 'error',
        message: `${t('app.appDeleteFailed')}${'message' in e ? `: ${e.message}` : ''}`,
      })
    }
    setShowConfirmDelete(false)
  }, [appDetail, mutateApps, notify, onPlanInfoChanged, replace, t])

  const { isCurrentWorkspaceEditor } = useAppContext()

  if (!appDetail)
    return null

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => {
            if (isCurrentWorkspaceEditor)
              setOpen(v => !v)
          }}
          className='block'
        >
          <div className={cn('flex p-1 rounded-lg', open && 'bg-gray-100', isCurrentWorkspaceEditor && 'hover:bg-gray-100 cursor-pointer')}>
            <div className='relative shrink-0 mr-2'>
              <AppIcon
                size={expand ? 'large' : 'small'}
                iconType={appDetail.icon_type}
                icon={appDetail.icon}
                background={appDetail.icon_background}
                imageUrl={appDetail.icon_url}
              />
              <span className={cn(
                'absolute bottom-[-3px] right-[-3px] w-4 h-4 p-0.5 bg-white rounded border-[0.5px] border-[rgba(0,0,0,0.02)] shadow-sm',
                !expand && '!w-3.5 !h-3.5 !bottom-[-2px] !right-[-2px]',
              )}>
                {appDetail.mode === 'advanced-chat' && (
                  <ChatBot className={cn('w-3 h-3 text-[#1570EF]', !expand && '!w-2.5 !h-2.5')} />
                )}
                {appDetail.mode === 'agent-chat' && (
                  <CuteRobot className={cn('w-3 h-3 text-indigo-600', !expand && '!w-2.5 !h-2.5')} />
                )}
                {appDetail.mode === 'chat' && (
                  <ChatBot className={cn('w-3 h-3 text-[#1570EF]', !expand && '!w-2.5 !h-2.5')} />
                )}
                {appDetail.mode === 'completion' && (
                  <AiText className={cn('w-3 h-3 text-[#0E9384]', !expand && '!w-2.5 !h-2.5')} />
                )}
                {appDetail.mode === 'workflow' && (
                  <Route className={cn('w-3 h-3 text-[#f79009]', !expand && '!w-2.5 !h-2.5')} />
                )}
              </span>
            </div>
            {expand && (
              <div className="grow w-0">
                <div className='flex justify-between items-center text-sm leading-5 font-medium text-text-secondary'>
                  <div className='truncate' title={appDetail.name}>{appDetail.name}</div>
                  {isCurrentWorkspaceEditor && <RiArrowDownSLine className='shrink-0 ml-[2px] w-3 h-3 text-gray-500' />}
                </div>
                <div className='flex items-center text-[10px] leading-[18px] font-medium text-gray-500 gap-1'>
                  {appDetail.mode === 'advanced-chat' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.chatbot').toUpperCase()}</div>
                      <div title={t('app.types.advanced') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.advanced').toUpperCase()}</div>
                    </>
                  )}
                  {appDetail.mode === 'agent-chat' && (
                    <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.agent').toUpperCase()}</div>
                  )}
                  {appDetail.mode === 'chat' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.chatbot').toUpperCase()}</div>
                      <div title={t('app.types.basic') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{(t('app.types.basic').toUpperCase())}</div>
                    </>
                  )}
                  {appDetail.mode === 'completion' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.completion').toUpperCase()}</div>
                      <div title={t('app.types.basic') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{(t('app.types.basic').toUpperCase())}</div>
                    </>
                  )}
                  {appDetail.mode === 'workflow' && (
                    <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.workflow').toUpperCase()}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1002]'>
          <div className='relative w-[320px] bg-white rounded-2xl shadow-xl'>
            {/* header */}
            <div className={cn('flex pl-4 pt-3 pr-3', !appDetail.description && 'pb-2')}>
              <div className='relative shrink-0 mr-2'>
                <AppIcon
                  size="large"
                  iconType={appDetail.icon_type}
                  icon={appDetail.icon}
                  background={appDetail.icon_background}
                  imageUrl={appDetail.icon_url}
                />
                <span className='absolute bottom-[-3px] right-[-3px] w-4 h-4 p-0.5 bg-white rounded border-[0.5px] border-[rgba(0,0,0,0.02)] shadow-sm'>
                  {appDetail.mode === 'advanced-chat' && (
                    <ChatBot className='w-3 h-3 text-[#1570EF]' />
                  )}
                  {appDetail.mode === 'agent-chat' && (
                    <CuteRobot className='w-3 h-3 text-indigo-600' />
                  )}
                  {appDetail.mode === 'chat' && (
                    <ChatBot className='w-3 h-3 text-[#1570EF]' />
                  )}
                  {appDetail.mode === 'completion' && (
                    <AiText className='w-3 h-3 text-[#0E9384]' />
                  )}
                  {appDetail.mode === 'workflow' && (
                    <Route className='w-3 h-3 text-[#f79009]' />
                  )}
                </span>
              </div>
              <div className='grow w-0'>
                <div title={appDetail.name} className='flex justify-between items-center text-sm leading-5 font-medium text-gray-900 truncate'>{appDetail.name}</div>
                <div className='flex items-center text-[10px] leading-[18px] font-medium text-gray-500 gap-1'>
                  {appDetail.mode === 'advanced-chat' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.chatbot').toUpperCase()}</div>
                      <div title={t('app.types.advanced') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.advanced').toUpperCase()}</div>
                    </>
                  )}
                  {appDetail.mode === 'agent-chat' && (
                    <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.agent').toUpperCase()}</div>
                  )}
                  {appDetail.mode === 'chat' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.chatbot').toUpperCase()}</div>
                      <div title={t('app.types.basic') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{(t('app.types.basic').toUpperCase())}</div>
                    </>
                  )}
                  {appDetail.mode === 'completion' && (
                    <>
                      <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.completion').toUpperCase()}</div>
                      <div title={t('app.types.basic') || ''} className='px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{(t('app.types.basic').toUpperCase())}</div>
                    </>
                  )}
                  {appDetail.mode === 'workflow' && (
                    <div className='shrink-0 px-1 border bg-white border-[rgba(0,0,0,0.08)] rounded-[5px] truncate'>{t('app.types.workflow').toUpperCase()}</div>
                  )}
                </div>
              </div>
            </div>
            {/* description */}
            {appDetail.description && (
              <div className='px-4 py-2 text-gray-500 text-xs leading-[18px]'>{appDetail.description}</div>
            )}
            {/* operations */}
            <Divider className="!my-1" />
            <div className="w-full py-1">
              <div className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer' onClick={() => {
                setOpen(false)
                setShowEditModal(true)
              }}>
                <span className='text-gray-700 text-sm leading-5'>{t('app.editApp')}</span>
              </div>
              <div className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer' onClick={() => {
                setOpen(false)
                setShowDuplicateModal(true)
              }}>
                <span className='text-gray-700 text-sm leading-5'>{t('app.duplicate')}</span>
              </div>
              {(appDetail.mode === 'completion' || appDetail.mode === 'chat') && (
                <>
                  <Divider className="!my-1" />
                  <div
                    className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer'
                    onMouseEnter={() => setShowSwitchTip(appDetail.mode)}
                    onMouseLeave={() => setShowSwitchTip('')}
                    onClick={() => {
                      setOpen(false)
                      setShowSwitchModal(true)
                    }}
                  >
                    <span className='text-gray-700 text-sm leading-5'>{t('app.switch')}</span>
                  </div>
                </>
              )}
              <Divider className="!my-1" />
              <div className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer' onClick={exportCheck}>
                <span className='text-gray-700 text-sm leading-5'>{t('app.export')}</span>
              </div>
              {
                (appDetail.mode === 'advanced-chat' || appDetail.mode === 'workflow') && (
                  <div
                    className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer'
                    onClick={() => {
                      setOpen(false)
                      setShowImportDSLModal(true)
                    }}>
                    <span className='text-gray-700 text-sm leading-5'>{t('workflow.common.importDSL')}</span>
                  </div>
                )
              }
              <Divider className="!my-1" />
              <div className='group h-9 py-2 px-3 mx-1 flex items-center hover:bg-red-50 rounded-lg cursor-pointer' onClick={() => {
                setOpen(false)
                setShowConfirmDelete(true)
              }}>
                <span className='text-gray-700 text-sm leading-5 group-hover:text-red-500'>
                  {t('common.operation.delete')}
                </span>
              </div>
            </div>
            {/* switch tip */}
            <div
              className={cn(
                'hidden absolute left-[324px] top-0 w-[376px] rounded-xl bg-white border-[0.5px] border-[rgba(0,0,0,0.05)] shadow-lg',
                showSwitchTip && '!block',
              )}
            >
              <div className={cn(
                'w-full h-[256px] bg-center bg-no-repeat bg-contain rounded-xl',
                showSwitchTip === 'chat' && s.expertPic,
                showSwitchTip === 'completion' && s.completionPic,
              )} />
              <div className='px-4 pb-2'>
                <div className='flex items-center gap-1 text-gray-700 text-md leading-6 font-semibold'>
                  {showSwitchTip === 'chat' ? t('app.types.advanced') : t('app.types.workflow')}
                  <span className='px-1 rounded-[5px] bg-white border border-black/8 text-gray-500 text-[10px] leading-[18px] font-medium'>BETA</span>
                </div>
                <div className='text-orange-500 text-xs leading-[18px] font-medium'>{t('app.newApp.advancedFor').toLocaleUpperCase()}</div>
                <div className='mt-1 text-gray-500 text-sm leading-5'>{t('app.newApp.advancedDescription')}</div>
              </div>
            </div>
          </div>
        </PortalToFollowElemContent>
        {showSwitchModal && (
          <SwitchAppModal
            inAppDetail
            show={showSwitchModal}
            appDetail={appDetail}
            onClose={() => setShowSwitchModal(false)}
            onSuccess={() => setShowSwitchModal(false)}
          />
        )}
        {showEditModal && (
          <CreateAppModal
            isEditModal
            appName={appDetail.name}
            appIconType={appDetail.icon_type}
            appIcon={appDetail.icon}
            appIconBackground={appDetail.icon_background}
            appIconUrl={appDetail.icon_url}
            appDescription={appDetail.description}
            appMode={appDetail.mode}
            appUseIconAsAnswerIcon={appDetail.use_icon_as_answer_icon}
            show={showEditModal}
            onConfirm={onEdit}
            onHide={() => setShowEditModal(false)}
          />
        )}
        {showDuplicateModal && (
          <DuplicateAppModal
            appName={appDetail.name}
            icon_type={appDetail.icon_type}
            icon={appDetail.icon}
            icon_background={appDetail.icon_background}
            icon_url={appDetail.icon_url}
            show={showDuplicateModal}
            onConfirm={onCopy}
            onHide={() => setShowDuplicateModal(false)}
          />
        )}
        {showConfirmDelete && (
          <Confirm
            title={t('app.deleteAppConfirmTitle')}
            content={t('app.deleteAppConfirmContent')}
            isShow={showConfirmDelete}
            onConfirm={onConfirmDelete}
            onCancel={() => setShowConfirmDelete(false)}
          />
        )}
        {showImportDSLModal && (
          <UpdateDSLModal
            onCancel={() => setShowImportDSLModal(false)}
            onBackup={exportCheck}
          />
        )}
        {secretEnvList.length > 0 && (
          <DSLExportConfirmModal
            envList={secretEnvList}
            onConfirm={onExport}
            onClose={() => setSecretEnvList([])}
          />
        )}
      </div>
    </PortalToFollowElem>
  )
}

export default React.memo(AppInfo)
