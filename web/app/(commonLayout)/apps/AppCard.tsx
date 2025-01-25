'use client'

import { useContext, useContextSelector } from 'use-context-selector'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import s from './style.module.css'
import cn from '@/utils/classnames'
import type { App } from '@/types/app'
import Confirm from '@/app/components/base/confirm'
import Toast, { ToastContext } from '@/app/components/base/toast'
import { copyApp, deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import DuplicateAppModal from '@/app/components/app/duplicate-modal'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import AppIcon from '@/app/components/base/app-icon'
import AppsContext, { useAppContext } from '@/context/app-context'
import type { HtmlContentProps } from '@/app/components/base/popover'
import CustomPopover from '@/app/components/base/popover'
import Divider from '@/app/components/base/divider'
import { getRedirection } from '@/utils/app-redirection'
import { useProviderContext } from '@/context/provider-context'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import EditAppModal from '@/app/components/explore/create-app-modal'
import SwitchAppModal from '@/app/components/app/switch-app-modal'
import type { Tag } from '@/app/components/base/tag-management/constant'
import TagSelector from '@/app/components/base/tag-management/selector'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import DSLExportConfirmModal from '@/app/components/workflow/dsl-export-confirm-modal'
import { fetchWorkflowDraft } from '@/service/workflow'
import { fetchInstalledAppList } from '@/service/explore'
import { AppTypeIcon } from '@/app/components/app/type-selector'

export type AppCardProps = {
  app: App
  onRefresh?: () => void
}

const AppCard = ({ app, onRefresh }: AppCardProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { isCurrentWorkspaceEditor } = useAppContext()
  const { onPlanInfoChanged } = useProviderContext()
  const { push } = useRouter()

  const mutateApps = useContextSelector(
    AppsContext,
    state => state.mutateApps,
  )

  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])

  const onConfirmDelete = useCallback(async () => {
    try {
      await deleteApp(app.id)
      notify({ type: 'success', message: t('app.appDeleted') })
      if (onRefresh)
        onRefresh()
      mutateApps()
      onPlanInfoChanged()
    }
    catch (e: any) {
      notify({
        type: 'error',
        message: `${t('app.appDeleteFailed')}${'message' in e ? `: ${e.message}` : ''}`,
      })
    }
    setShowConfirmDelete(false)
  }, [app.id])

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
  }) => {
    try {
      await updateAppInfo({
        appID: app.id,
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
      if (onRefresh)
        onRefresh()
      mutateApps()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.editFailed') })
    }
  }, [app.id, mutateApps, notify, onRefresh, t])

  const onCopy: DuplicateAppModalProps['onConfirm'] = async ({ name, icon_type, icon, icon_background }) => {
    try {
      const newApp = await copyApp({
        appID: app.id,
        name,
        icon_type,
        icon,
        icon_background,
        mode: app.mode,
      })
      setShowDuplicateModal(false)
      notify({
        type: 'success',
        message: t('app.newApp.appCreated'),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      if (onRefresh)
        onRefresh()
      mutateApps()
      onPlanInfoChanged()
      getRedirection(isCurrentWorkspaceEditor, newApp, push)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
  }

  const onExport = async (include = false) => {
    try {
      const { data } = await exportAppConfig({
        appID: app.id,
        include,
      })
      const a = document.createElement('a')
      const file = new Blob([data], { type: 'application/yaml' })
      a.href = URL.createObjectURL(file)
      a.download = `${app.name}.yml`
      a.click()
    }
    catch (e) {
      notify({ type: 'error', message: t('app.exportFailed') })
    }
  }

  const exportCheck = async () => {
    if (app.mode !== 'workflow' && app.mode !== 'advanced-chat') {
      onExport()
      return
    }
    try {
      const workflowDraft = await fetchWorkflowDraft(`/apps/${app.id}/workflows/draft`)
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

  const onSwitch = () => {
    if (onRefresh)
      onRefresh()
    mutateApps()
    setShowSwitchModal(false)
  }

  const Operations = (props: HtmlContentProps) => {
    const onMouseLeave = async () => {
      props.onClose?.()
    }
    const onClickSettings = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      setShowEditModal(true)
    }
    const onClickDuplicate = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      setShowDuplicateModal(true)
    }
    const onClickExport = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      exportCheck()
    }
    const onClickSwitch = async (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      setShowSwitchModal(true)
    }
    const onClickDelete = async (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      setShowConfirmDelete(true)
    }
    const onClickInstalledApp = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation()
      props.onClick?.()
      e.preventDefault()
      try {
        const { installed_apps }: any = await fetchInstalledAppList(app.id) || {}
        if (installed_apps?.length > 0)
          window.open(`/explore/installed/${installed_apps[0].id}`, '_blank')
        else
          throw new Error('No app found in Explore')
      }
      catch (e: any) {
        Toast.notify({ type: 'error', message: `${e.message || e}` })
      }
    }
    return (
      <div className="relative w-full py-1" onMouseLeave={onMouseLeave}>
        <button className={s.actionItem} onClick={onClickSettings}>
          <span className={s.actionName}>{t('app.editApp')}</span>
        </button>
        <Divider className="!my-1" />
        <button className={s.actionItem} onClick={onClickDuplicate}>
          <span className={s.actionName}>{t('app.duplicate')}</span>
        </button>
        <button className={s.actionItem} onClick={onClickExport}>
          <span className={s.actionName}>{t('app.export')}</span>
        </button>
        {(app.mode === 'completion' || app.mode === 'chat') && (
          <>
            <Divider className="!my-1" />
            <div
              className='h-9 py-2 px-3 mx-1 flex items-center hover:bg-gray-50 rounded-lg cursor-pointer'
              onClick={onClickSwitch}
            >
              <span className='text-gray-700 text-sm leading-5'>{t('app.switch')}</span>
            </div>
          </>
        )}
        <Divider className="!my-1" />
        <button className={s.actionItem} onClick={onClickInstalledApp}>
          <span className={s.actionName}>{t('app.openInExplore')}</span>
        </button>
        <Divider className="!my-1" />
        <div
          className={cn(s.actionItem, s.deleteActionItem, 'group')}
          onClick={onClickDelete}
        >
          <span className={cn(s.actionName, 'group-hover:text-red-500')}>
            {t('common.operation.delete')}
          </span>
        </div>
      </div>
    )
  }

  const [tags, setTags] = useState<Tag[]>(app.tags)
  useEffect(() => {
    setTags(app.tags)
  }, [app.tags])

  return (
    <>
      <div
        onClick={(e) => {
          e.preventDefault()
          getRedirection(isCurrentWorkspaceEditor, app, push)
        }}
        className='relative h-[160px] group col-span-1 bg-components-card-bg border-[1px] border-solid border-components-card-border rounded-xl shadow-sm inline-flex flex-col transition-all duration-200 ease-in-out cursor-pointer hover:shadow-lg'
      >
        <div className='flex pt-[14px] px-[14px] pb-3 h-[66px] items-center gap-3 grow-0 shrink-0'>
          <div className='relative shrink-0'>
            <AppIcon
              size="large"
              iconType={app.icon_type}
              icon={app.icon}
              background={app.icon_background}
              imageUrl={app.icon_url}
            />
            <AppTypeIcon type={app.mode} wrapperClassName='absolute -bottom-0.5 -right-0.5 w-4 h-4 shadow-sm' className='w-3 h-3' />
          </div>
          <div className='grow w-0 py-[1px]'>
            <div className='flex items-center text-sm leading-5 font-semibold text-text-secondary'>
              <div className='truncate' title={app.name}>{app.name}</div>
            </div>
            <div className='flex items-center text-[10px] leading-[18px] text-text-tertiary font-medium'>
              {app.mode === 'advanced-chat' && <div className='truncate'>{t('app.types.advanced').toUpperCase()}</div>}
              {app.mode === 'chat' && <div className='truncate'>{t('app.types.chatbot').toUpperCase()}</div>}
              {app.mode === 'agent-chat' && <div className='truncate'>{t('app.types.agent').toUpperCase()}</div>}
              {app.mode === 'workflow' && <div className='truncate'>{t('app.types.workflow').toUpperCase()}</div>}
              {app.mode === 'completion' && <div className='truncate'>{t('app.types.completion').toUpperCase()}</div>}
            </div>
          </div>
        </div>
        <div className='title-wrapper h-[90px] px-[14px] text-xs leading-normal text-text-tertiary'>
          <div
            className={cn(tags.length ? 'line-clamp-2' : 'line-clamp-4', 'group-hover:line-clamp-2')}
            title={app.description}
          >
            {app.description}
          </div>
        </div>
        <div className={cn(
          'absolute bottom-1 left-0 right-0 items-center shrink-0 pt-1 pl-[14px] pr-[6px] pb-[6px] h-[42px]',
          tags.length ? 'flex' : '!hidden group-hover:!flex',
        )}>
          {isCurrentWorkspaceEditor && (
            <>
              <div className={cn('grow flex items-center gap-1 w-0')} onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}>
                <div className={cn(
                  'group-hover:!block group-hover:!mr-0 mr-[41px] grow w-full',
                  tags.length ? '!block' : '!hidden',
                )}>
                  <TagSelector
                    position='bl'
                    type='app'
                    targetID={app.id}
                    value={tags.map(tag => tag.id)}
                    selectedTags={tags}
                    onCacheUpdate={setTags}
                    onChange={onRefresh}
                  />
                </div>
              </div>
              <div className='!hidden group-hover:!flex shrink-0 mx-1 w-[1px] h-[14px]' />
              <div className='!hidden group-hover:!flex shrink-0'>
                <CustomPopover
                  htmlContent={<Operations />}
                  position="br"
                  trigger="click"
                  btnElement={
                    <div
                      className='flex items-center justify-center w-8 h-8 cursor-pointer rounded-md'
                    >
                      <RiMoreFill className='w-4 h-4 text-text-tertiary' />
                    </div>
                  }
                  btnClassName={open =>
                    cn(
                      open ? '!bg-black/5 !shadow-none' : '!bg-transparent',
                      'h-8 w-8 !p-2 rounded-md border-none hover:!bg-black/5',
                    )
                  }
                  popupClassName={
                    (app.mode === 'completion' || app.mode === 'chat')
                      ? '!w-[256px] translate-x-[-224px]'
                      : '!w-[160px] translate-x-[-128px]'
                  }
                  className={'h-fit !z-20'}
                />
              </div>
            </>
          )}
        </div>
      </div>
      {showEditModal && (
        <EditAppModal
          isEditModal
          appName={app.name}
          appIconType={app.icon_type}
          appIcon={app.icon}
          appIconBackground={app.icon_background}
          appIconUrl={app.icon_url}
          appDescription={app.description}
          appMode={app.mode}
          appUseIconAsAnswerIcon={app.use_icon_as_answer_icon}
          show={showEditModal}
          onConfirm={onEdit}
          onHide={() => setShowEditModal(false)}
        />
      )}
      {showDuplicateModal && (
        <DuplicateAppModal
          appName={app.name}
          icon_type={app.icon_type}
          icon={app.icon}
          icon_background={app.icon_background}
          icon_url={app.icon_url}
          show={showDuplicateModal}
          onConfirm={onCopy}
          onHide={() => setShowDuplicateModal(false)}
        />
      )}
      {showSwitchModal && (
        <SwitchAppModal
          show={showSwitchModal}
          appDetail={app}
          onClose={() => setShowSwitchModal(false)}
          onSuccess={onSwitch}
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
      {secretEnvList.length > 0 && (
        <DSLExportConfirmModal
          envList={secretEnvList}
          onConfirm={onExport}
          onClose={() => setSecretEnvList([])}
        />
      )}
    </>
  )
}

export default AppCard
