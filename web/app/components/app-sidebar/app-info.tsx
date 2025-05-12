import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import React, { useCallback, useState } from 'react'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
  RiExchange2Line,
  RiFileCopy2Line,
  RiFileDownloadLine,
  RiFileUploadLine,
  RiMoreLine,
} from '@remixicon/react'
import AppIcon from '../base/app-icon'
import SwitchAppModal from '../app/switch-app-modal'
import cn from '@/utils/classnames'
import Confirm from '@/app/components/base/confirm'
import { useStore as useAppStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import AppsContext, { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { copyApp, deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import DuplicateAppModal from '@/app/components/app/duplicate-modal'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import CreateAppModal from '@/app/components/explore/create-app-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import UpdateDSLModal from '@/app/components/workflow/update-dsl-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import DSLExportConfirmModal from '@/app/components/workflow/dsl-export-confirm-modal'
import { fetchWorkflowDraft } from '@/service/workflow'
import ContentDialog from '@/app/components/base/content-dialog'
import Button from '@/app/components/base/button'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/cardView'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '../base/portal-to-follow-elem'

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
    catch {
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
    catch {
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
    catch {
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
    catch {
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
  }, [appDetail, mutateApps, notify, onPlanInfoChanged, replace, setAppDetail, t])

  const { isCurrentWorkspaceEditor } = useAppContext()

  const [showMore, setShowMore] = useState(false)
  const handleTriggerMore = useCallback(() => {
    setShowMore(true)
  }, [setShowMore])

  if (!appDetail)
    return null

  return (
    <div>
      <button
        onClick={() => {
          if (isCurrentWorkspaceEditor)
            setOpen(v => !v)
        }}
        className='block w-full'
      >
        <div className={cn('flex rounded-lg', expand ? 'flex-col gap-2 p-2 pb-2.5' : 'items-start justify-center gap-1 p-1', open && 'bg-state-base-hover', isCurrentWorkspaceEditor && 'cursor-pointer hover:bg-state-base-hover')}>
          <div className={`flex items-center self-stretch ${expand ? 'justify-between' : 'flex-col gap-1'}`}>
            <AppIcon
              size={expand ? 'large' : 'small'}
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
            <div className='flex items-center justify-center rounded-md p-0.5'>
              <div className='flex h-5 w-5 items-center justify-center'>
                <RiEqualizer2Line className='h-4 w-4 text-text-tertiary' />
              </div>
            </div>
          </div>
          {
            expand && (
              <div className='flex flex-col items-start gap-1'>
                <div className='flex w-full'>
                  <div className='system-md-semibold truncate text-text-secondary'>{appDetail.name}</div>
                </div>
                <div className='system-2xs-medium-uppercase text-text-tertiary'>{appDetail.mode === 'advanced-chat' ? t('app.types.advanced') : appDetail.mode === 'agent-chat' ? t('app.types.agent') : appDetail.mode === 'chat' ? t('app.types.chatbot') : appDetail.mode === 'completion' ? t('app.types.completion') : t('app.types.workflow')}</div>
              </div>
            )
          }
        </div>
      </button>
      <ContentDialog
        show={open}
        onClose={() => setOpen(false)}
        className='absolute bottom-2 left-2 top-2 flex w-[420px] flex-col rounded-2xl !p-0'
      >
        <div className='flex shrink-0 flex-col items-start justify-center gap-3 self-stretch p-4'>
          <div className='flex items-center gap-3 self-stretch'>
            <AppIcon
              size="large"
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
            <div className='flex w-full grow flex-col items-start justify-center'>
              <div className='system-md-semibold w-full truncate text-text-secondary'>{appDetail.name}</div>
              <div className='system-2xs-medium-uppercase text-text-tertiary'>{appDetail.mode === 'advanced-chat' ? t('app.types.advanced') : appDetail.mode === 'agent-chat' ? t('app.types.agent') : appDetail.mode === 'chat' ? t('app.types.chatbot') : appDetail.mode === 'completion' ? t('app.types.completion') : t('app.types.workflow')}</div>
            </div>
          </div>
          {/* description */}
          {appDetail.description && (
            <div className='system-xs-regular text-text-tertiary'>{appDetail.description}</div>
          )}
          {/* operations */}
          <div className='flex flex-wrap items-center gap-1 self-stretch'>
            <Button
              size={'small'}
              variant={'secondary'}
              className='gap-[1px]'
              onClick={() => {
                setOpen(false)
                setShowEditModal(true)
              }}
            >
              <RiEditLine className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <span className='system-xs-medium text-components-button-secondary-text'>{t('app.editApp')}</span>
            </Button>
            <Button
              size={'small'}
              variant={'secondary'}
              className='gap-[1px]'
              onClick={() => {
                setOpen(false)
                setShowDuplicateModal(true)
              }}
            >
              <RiFileCopy2Line className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <span className='system-xs-medium text-components-button-secondary-text'>{t('app.duplicate')}</span>
            </Button>
            <Button
              size={'small'}
              variant={'secondary'}
              className='gap-[1px]'
              onClick={exportCheck}
            >
              <RiFileDownloadLine className='h-3.5 w-3.5 text-components-button-secondary-text' />
              <span className='system-xs-medium text-components-button-secondary-text'>{t('app.export')}</span>
            </Button>
            {appDetail.mode !== 'agent-chat' && <PortalToFollowElem
              open={showMore}
              onOpenChange={setShowMore}
              placement='bottom-end'
              offset={{
                mainAxis: 4,
              }}>
              <PortalToFollowElemTrigger onClick={handleTriggerMore}>
                <Button
                  size={'small'}
                  variant={'secondary'}
                  className='gap-[1px]'
                >
                  <RiMoreLine className='h-3.5 w-3.5 text-components-button-secondary-text' />
                  <span className='system-xs-medium text-components-button-secondary-text'>{t('common.operation.more')}</span>
                </Button>
              </PortalToFollowElemTrigger>
              <PortalToFollowElemContent className='z-[21]'>
                <div className='flex w-[264px] flex-col rounded-[12px] border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]'>
                  {
                    (appDetail.mode === 'advanced-chat' || appDetail.mode === 'workflow')
                    && <div className='flex h-8 cursor-pointer items-center gap-x-1 rounded-lg p-1.5 hover:bg-state-base-hover'
                      onClick={() => {
                        setOpen(false)
                        setShowImportDSLModal(true)
                      }}>
                      <RiFileUploadLine className='h-4 w-4 text-text-tertiary' />
                      <span className='system-md-regular text-text-secondary'>{t('workflow.common.importDSL')}</span>
                    </div>
                  }
                  {
                    (appDetail.mode === 'completion' || appDetail.mode === 'chat')
                    && <div className='flex h-8 cursor-pointer items-center gap-x-1 rounded-lg p-1.5 hover:bg-state-base-hover'
                      onClick={() => {
                        setOpen(false)
                        setShowSwitchModal(true)
                      }}>
                      <RiExchange2Line className='h-4 w-4 text-text-tertiary' />
                      <span className='system-md-regular text-text-secondary'>{t('app.switch')}</span>
                    </div>
                  }
                </div>
              </PortalToFollowElemContent>
            </PortalToFollowElem>}
          </div>
        </div>
        <div className='flex flex-1'>
          <CardView
            appId={appDetail.id}
            isInPanel={true}
            className='flex grow flex-col gap-2 overflow-auto px-2 py-1'
          />
        </div>
        <div className='flex min-h-fit shrink-0 flex-col items-start justify-center gap-3 self-stretch border-t-[0.5px] border-divider-subtle p-2'>
          <Button
            size={'medium'}
            variant={'ghost'}
            className='gap-0.5'
            onClick={() => {
              setOpen(false)
              setShowConfirmDelete(true)
            }}
          >
            <RiDeleteBinLine className='h-4 w-4 text-text-tertiary' />
            <span className='system-sm-medium text-text-tertiary'>{t('common.operation.deleteApp')}</span>
          </Button>
        </div>
      </ContentDialog>
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
  )
}

export default React.memo(AppInfo)
