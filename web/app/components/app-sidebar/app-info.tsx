import type { Operation } from './app-operations'
import type { DuplicateAppModalProps } from '@/app/components/app/duplicate-modal'
import type { CreateAppModalProps } from '@/app/components/explore/create-app-modal'
import type { EnvironmentVariable } from '@/app/components/workflow/types'
import {
  RiDeleteBinLine,
  RiEditLine,
  RiEqualizer2Line,
  RiExchange2Line,
  RiFileCopy2Line,
  RiFileDownloadLine,
  RiFileUploadLine,
} from '@remixicon/react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import CardView from '@/app/(commonLayout)/app/(appDetailLayout)/[appId]/overview/card-view'
import { useStore as useAppStore } from '@/app/components/app/store'
import Button from '@/app/components/base/button'
import ContentDialog from '@/app/components/base/content-dialog'
import { ToastContext } from '@/app/components/base/toast'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { copyApp, deleteApp, exportAppConfig, updateAppInfo } from '@/service/apps'
import { useInvalidateAppList } from '@/service/use-apps'
import { fetchWorkflowDraft } from '@/service/workflow'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { cn } from '@/utils/classnames'
import AppIcon from '../base/app-icon'
import AppOperations from './app-operations'

const SwitchAppModal = dynamic(() => import('@/app/components/app/switch-app-modal'), {
  ssr: false,
})
const CreateAppModal = dynamic(() => import('@/app/components/explore/create-app-modal'), {
  ssr: false,
})
const DuplicateAppModal = dynamic(() => import('@/app/components/app/duplicate-modal'), {
  ssr: false,
})
const Confirm = dynamic(() => import('@/app/components/base/confirm'), {
  ssr: false,
})
const UpdateDSLModal = dynamic(() => import('@/app/components/workflow/update-dsl-modal'), {
  ssr: false,
})
const DSLExportConfirmModal = dynamic(() => import('@/app/components/workflow/dsl-export-confirm-modal'), {
  ssr: false,
})

export type IAppInfoProps = {
  expand: boolean
  onlyShowDetail?: boolean
  openState?: boolean
  onDetailExpand?: (expand: boolean) => void
}

const AppInfo = ({ expand, onlyShowDetail = false, openState = false, onDetailExpand }: IAppInfoProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)
  const { replace } = useRouter()
  const { onPlanInfoChanged } = useProviderContext()
  const appDetail = useAppStore(state => state.appDetail)
  const setAppDetail = useAppStore(state => state.setAppDetail)
  const invalidateAppList = useInvalidateAppList()
  const [open, setOpen] = useState(openState)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [showSwitchModal, setShowSwitchModal] = useState<boolean>(false)
  const [showImportDSLModal, setShowImportDSLModal] = useState<boolean>(false)
  const [secretEnvList, setSecretEnvList] = useState<EnvironmentVariable[]>([])
  const [showExportWarning, setShowExportWarning] = useState(false)

  const onEdit: CreateAppModalProps['onConfirm'] = useCallback(async ({
    name,
    icon_type,
    icon,
    icon_background,
    description,
    use_icon_as_answer_icon,
    max_active_requests,
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
        max_active_requests,
      })
      setShowEditModal(false)
      notify({
        type: 'success',
        message: t('editDone', { ns: 'app' }),
      })
      setAppDetail(app)
    }
    catch {
      notify({ type: 'error', message: t('editFailed', { ns: 'app' }) })
    }
  }, [appDetail, notify, setAppDetail, t])

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
        message: t('newApp.appCreated', { ns: 'app' }),
      })
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      onPlanInfoChanged()
      getRedirection(true, newApp, replace)
    }
    catch {
      notify({ type: 'error', message: t('newApp.appCreateFailed', { ns: 'app' }) })
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
      const url = URL.createObjectURL(file)
      a.href = url
      a.download = `${appDetail.name}.yml`
      a.click()
      URL.revokeObjectURL(url)
    }
    catch {
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
  }

  const exportCheck = async () => {
    if (!appDetail)
      return
    if (appDetail.mode !== AppModeEnum.WORKFLOW && appDetail.mode !== AppModeEnum.ADVANCED_CHAT) {
      onExport()
      return
    }

    setShowExportWarning(true)
  }

  const handleConfirmExport = async () => {
    if (!appDetail)
      return
    setShowExportWarning(false)
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
      notify({ type: 'error', message: t('exportFailed', { ns: 'app' }) })
    }
  }

  const onConfirmDelete = useCallback(async () => {
    if (!appDetail)
      return
    try {
      await deleteApp(appDetail.id)
      notify({ type: 'success', message: t('appDeleted', { ns: 'app' }) })
      invalidateAppList()
      onPlanInfoChanged()
      setAppDetail()
      replace('/apps')
    }
    catch (e: any) {
      notify({
        type: 'error',
        message: `${t('appDeleteFailed', { ns: 'app' })}${'message' in e ? `: ${e.message}` : ''}`,
      })
    }
    setShowConfirmDelete(false)
  }, [appDetail, invalidateAppList, notify, onPlanInfoChanged, replace, setAppDetail, t])

  const { isCurrentWorkspaceEditor } = useAppContext()

  if (!appDetail)
    return null

  const primaryOperations = [
    {
      id: 'edit',
      title: t('editApp', { ns: 'app' }),
      icon: <RiEditLine />,
      onClick: () => {
        setOpen(false)
        onDetailExpand?.(false)
        setShowEditModal(true)
      },
    },
    {
      id: 'duplicate',
      title: t('duplicate', { ns: 'app' }),
      icon: <RiFileCopy2Line />,
      onClick: () => {
        setOpen(false)
        onDetailExpand?.(false)
        setShowDuplicateModal(true)
      },
    },
    {
      id: 'export',
      title: t('export', { ns: 'app' }),
      icon: <RiFileDownloadLine />,
      onClick: exportCheck,
    },
  ]

  const secondaryOperations: Operation[] = [
    // Import DSL (conditional)
    ...(appDetail.mode === AppModeEnum.ADVANCED_CHAT || appDetail.mode === AppModeEnum.WORKFLOW)
      ? [{
          id: 'import',
          title: t('common.importDSL', { ns: 'workflow' }),
          icon: <RiFileUploadLine />,
          onClick: () => {
            setOpen(false)
            onDetailExpand?.(false)
            setShowImportDSLModal(true)
          },
        }]
      : [],
    // Divider
    {
      id: 'divider-1',
      title: '',
      icon: <></>,
      onClick: () => { /* divider has no action */ },
      type: 'divider' as const,
    },
    // Delete operation
    {
      id: 'delete',
      title: t('operation.delete', { ns: 'common' }),
      icon: <RiDeleteBinLine />,
      onClick: () => {
        setOpen(false)
        onDetailExpand?.(false)
        setShowConfirmDelete(true)
      },
    },
  ]

  // Keep the switch operation separate as it's not part of the main operations
  const switchOperation = (appDetail.mode === AppModeEnum.COMPLETION || appDetail.mode === AppModeEnum.CHAT)
    ? {
        id: 'switch',
        title: t('switch', { ns: 'app' }),
        icon: <RiExchange2Line />,
        onClick: () => {
          setOpen(false)
          onDetailExpand?.(false)
          setShowSwitchModal(true)
        },
      }
    : null

  return (
    <div>
      {!onlyShowDetail && (
        <button
          type="button"
          onClick={() => {
            if (isCurrentWorkspaceEditor)
              setOpen(v => !v)
          }}
          className="block w-full"
        >
          <div className="flex flex-col gap-2 rounded-lg p-1 hover:bg-state-base-hover">
            <div className="flex items-center gap-1">
              <div className={cn(!expand && 'ml-1')}>
                <AppIcon
                  size={expand ? 'large' : 'small'}
                  iconType={appDetail.icon_type}
                  icon={appDetail.icon}
                  background={appDetail.icon_background}
                  imageUrl={appDetail.icon_url}
                />
              </div>
              {expand && (
                <div className="ml-auto flex items-center justify-center rounded-md p-0.5">
                  <div className="flex h-5 w-5 items-center justify-center">
                    <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                  </div>
                </div>
              )}
            </div>
            {!expand && (
              <div className="flex items-center justify-center">
                <div className="flex h-5 w-5 items-center justify-center rounded-md p-0.5">
                  <RiEqualizer2Line className="h-4 w-4 text-text-tertiary" />
                </div>
              </div>
            )}
            {expand && (
              <div className="flex flex-col items-start gap-1">
                <div className="flex w-full">
                  <div className="system-md-semibold truncate whitespace-nowrap text-text-secondary">{appDetail.name}</div>
                </div>
                <div className="system-2xs-medium-uppercase whitespace-nowrap text-text-tertiary">
                  {appDetail.mode === AppModeEnum.ADVANCED_CHAT
                    ? t('types.advanced', { ns: 'app' })
                    : appDetail.mode === AppModeEnum.AGENT_CHAT
                      ? t('types.agent', { ns: 'app' })
                      : appDetail.mode === AppModeEnum.CHAT
                        ? t('types.chatbot', { ns: 'app' })
                        : appDetail.mode === AppModeEnum.COMPLETION
                          ? t('types.completion', { ns: 'app' })
                          : t('types.workflow', { ns: 'app' })}
                </div>
              </div>
            )}
          </div>
        </button>
      )}
      <ContentDialog
        show={onlyShowDetail ? openState : open}
        onClose={() => {
          setOpen(false)
          onDetailExpand?.(false)
        }}
        className="absolute bottom-2 left-2 top-2 flex w-[420px] flex-col rounded-2xl !p-0"
      >
        <div className="flex shrink-0 flex-col items-start justify-center gap-3 self-stretch p-4">
          <div className="flex items-center gap-3 self-stretch">
            <AppIcon
              size="large"
              iconType={appDetail.icon_type}
              icon={appDetail.icon}
              background={appDetail.icon_background}
              imageUrl={appDetail.icon_url}
            />
            <div className="flex flex-1 flex-col items-start justify-center overflow-hidden">
              <div className="system-md-semibold w-full truncate text-text-secondary">{appDetail.name}</div>
              <div className="system-2xs-medium-uppercase text-text-tertiary">{appDetail.mode === AppModeEnum.ADVANCED_CHAT ? t('types.advanced', { ns: 'app' }) : appDetail.mode === AppModeEnum.AGENT_CHAT ? t('types.agent', { ns: 'app' }) : appDetail.mode === AppModeEnum.CHAT ? t('types.chatbot', { ns: 'app' }) : appDetail.mode === AppModeEnum.COMPLETION ? t('types.completion', { ns: 'app' }) : t('types.workflow', { ns: 'app' })}</div>
            </div>
          </div>
          {/* description */}
          {appDetail.description && (
            <div className="system-xs-regular overflow-wrap-anywhere max-h-[105px] w-full max-w-full overflow-y-auto whitespace-normal break-words text-text-tertiary">{appDetail.description}</div>
          )}
          {/* operations */}
          <AppOperations
            gap={4}
            primaryOperations={primaryOperations}
            secondaryOperations={secondaryOperations}
          />
        </div>
        <CardView
          appId={appDetail.id}
          isInPanel={true}
          className="flex flex-1 flex-col gap-2 overflow-auto px-2 py-1"
        />
        {/* Switch operation (if available) */}
        {switchOperation && (
          <div className="flex min-h-fit shrink-0 flex-col items-start justify-center gap-3 self-stretch pb-2">
            <Button
              size="medium"
              variant="ghost"
              className="gap-0.5"
              onClick={switchOperation.onClick}
            >
              {switchOperation.icon}
              <span className="system-sm-medium text-text-tertiary">{switchOperation.title}</span>
            </Button>
          </div>
        )}
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
          max_active_requests={appDetail.max_active_requests ?? null}
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
          title={t('deleteAppConfirmTitle', { ns: 'app' })}
          content={t('deleteAppConfirmContent', { ns: 'app' })}
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
      {showExportWarning && (
        <Confirm
          type="info"
          isShow={showExportWarning}
          title={t('sidebar.exportWarning', { ns: 'workflow' })}
          content={t('sidebar.exportWarningDesc', { ns: 'workflow' })}
          onConfirm={handleConfirmExport}
          onCancel={() => setShowExportWarning(false)}
        />
      )}
    </div>
  )
}

export default React.memo(AppInfo)
