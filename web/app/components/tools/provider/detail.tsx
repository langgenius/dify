'use client'
import type { Collection, CustomCollectionBackend, Tool, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '../types'
import type { WorkflowToolDrawerPayload } from '@/app/components/tools/workflow-tool'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import {
  RiCloseLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Loading from '@/app/components/base/loading'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import Title from '@/app/components/plugins/card/base/title'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import { useCanManageTools } from '@/app/components/tools/hooks/use-tool-permissions'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import { WorkflowToolDrawer } from '@/app/components/tools/workflow-tool'
import { useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'

import { useProviderContext } from '@/context/provider-context'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { getLanguage } from '@/i18n-config/language'
import {
  deleteWorkflowTool,
  fetchBuiltInToolList,
  fetchCustomCollection,
  fetchCustomToolList,
  fetchModelToolList,
  fetchWorkflowToolDetail,
  removeBuiltInToolCredential,
  removeCustomCollection,
  saveWorkflowToolProvider,
  updateBuiltInToolCredential,
  updateCustomCollection,
} from '@/service/tools'
import { useInvalidateAllWorkflowTools } from '@/service/use-tools'
import { basePath } from '@/utils/var'
import { AuthHeaderPrefix, AuthType, CollectionType } from '../types'
import ToolItem from './tool-item'

type Props = Readonly<{
  collection: Collection
  onHide: () => void
  onRefreshData: () => void
}>

const ProviderDetail = ({
  collection,
  onHide,
  onRefreshData,
}: Props) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = getLanguage(locale)

  const needAuth = collection.allow_delete || collection.type === CollectionType.model
  const isAuthed = collection.is_team_authorization
  const isBuiltIn = collection.type === CollectionType.builtIn
  const isModel = collection.type === CollectionType.model
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const canOpenCredentialSettings = isAuthed ? canUseCredential : canCreateCredential
  const canSaveCredentialSettings = isAuthed ? canManageCredential : canCreateCredential
  const canManageTools = useCanManageTools()
  const invalidateAllWorkflowTools = useInvalidateAllWorkflowTools()
  const [isDetailLoading, setIsDetailLoading] = useState(false)

  // built in provider
  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const { setShowModelModal } = useModalContext()
  const { modelProviders: providers } = useProviderContext()
  const showSettingAuthModal = () => {
    if (!canOpenCredentialSettings)
      return

    if (isModel) {
      const provider = providers.find(item => item.provider === collection?.id)
      if (provider) {
        setShowModelModal({
          payload: {
            currentProvider: provider,
            currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
            currentCustomConfigurationModelFixedFields: undefined,
          },
          onSaveCallback: () => {
            onRefreshData()
          },
        })
      }
    }
    else {
      setShowSettingAuth(true)
    }
  }
  // custom provider
  const [customCollection, setCustomCollection] = useState<CustomCollectionBackend | WorkflowToolProviderResponse | null>(null)
  const [isShowEditCollectionToolModal, setIsShowEditCustomCollectionModal] = useState(false)
  const [showConfirmDelete, setShowConfirmDelete] = useState(false)
  const [deleteAction, setDeleteAction] = useState('')

  const getCustomProvider = useCallback(async () => {
    if (!canManageTools)
      return

    setIsDetailLoading(true)
    const res = await fetchCustomCollection(collection.name)
    if (res.credentials.auth_type === AuthType.apiKey && !res.credentials.api_key_header_prefix) {
      if (res.credentials.api_key_value)
        res.credentials.api_key_header_prefix = AuthHeaderPrefix.custom
    }
    setCustomCollection({
      ...res,
      labels: collection.labels,
      provider: collection.name,
    })
    setIsDetailLoading(false)
  }, [canManageTools, collection.labels, collection.name])

  const doUpdateCustomToolCollection = async (data: CustomCollectionBackend) => {
    if (!canManageTools)
      return

    await updateCustomCollection(data)
    onRefreshData()
    await getCustomProvider()
    // Use fresh data from form submission to avoid race condition with collection.labels
    setCustomCollection(prev => prev ? { ...prev, labels: data.labels } : null)
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setIsShowEditCustomCollectionModal(false)
  }
  const doRemoveCustomToolCollection = async () => {
    if (!canManageTools)
      return

    await removeCustomCollection(collection?.name as string)
    onRefreshData()
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setIsShowEditCustomCollectionModal(false)
  }
  // workflow provider
  const [workflowToolDrawerOpen, setWorkflowToolDrawerOpen] = useState(false)
  const getWorkflowToolProvider = useCallback(async () => {
    if (!canManageTools)
      return

    setIsDetailLoading(true)
    const res = await fetchWorkflowToolDetail(collection.id)
    const payload = {
      ...res,
      parameters: res.tool?.parameters.map((item) => {
        return {
          name: item.name,
          description: item.llm_description,
          form: item.form,
          required: item.required,
          type: item.type,
        }
      }) || [],
      labels: res.tool?.labels || [],
    }
    setCustomCollection(payload)
    setIsDetailLoading(false)
  }, [canManageTools, collection.id])
  const removeWorkflowToolProvider = async () => {
    if (!canManageTools)
      return

    await deleteWorkflowTool(collection.id)
    onRefreshData()
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setWorkflowToolDrawerOpen(false)
  }
  const updateWorkflowToolProvider = async (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => {
    if (!canManageTools)
      return

    await saveWorkflowToolProvider(data)
    invalidateAllWorkflowTools()
    onRefreshData()
    getWorkflowToolProvider()
    toast.success(t('api.actionSuccess', { ns: 'common' }))
    setWorkflowToolDrawerOpen(false)
  }
  const onClickCustomToolDelete = () => {
    setDeleteAction('customTool')
    setShowConfirmDelete(true)
  }
  const onClickWorkflowToolDelete = () => {
    setDeleteAction('workflowTool')
    setShowConfirmDelete(true)
  }
  const handleConfirmDelete = () => {
    if (deleteAction === 'customTool')
      doRemoveCustomToolCollection()

    else if (deleteAction === 'workflowTool')
      removeWorkflowToolProvider()

    setShowConfirmDelete(false)
  }

  // ToolList
  const [toolList, setToolList] = useState<Tool[]>([])
  const getProviderToolList = useCallback(async () => {
    setIsDetailLoading(true)
    try {
      if (collection.type === CollectionType.builtIn) {
        const list = await fetchBuiltInToolList(collection.name)
        setToolList(list)
      }
      else if (collection.type === CollectionType.model) {
        const list = await fetchModelToolList(collection.name)
        setToolList(list)
      }
      else if (collection.type === CollectionType.workflow) {
        setToolList([])
      }
      else {
        if (!canManageTools) {
          setToolList([])
          setIsDetailLoading(false)
          return
        }

        const list = await fetchCustomToolList(collection.name)
        setToolList(list)
      }
    }
    catch { }
    setIsDetailLoading(false)
  }, [canManageTools, collection.name, collection.type])

  useEffect(() => {
    if (collection.type === CollectionType.custom && canManageTools)
      getCustomProvider()
    if (collection.type === CollectionType.workflow && canManageTools)
      getWorkflowToolProvider()
    getProviderToolList()
  }, [canManageTools, collection.name, collection.type, getCustomProvider, getProviderToolList, getWorkflowToolProvider])

  return (
    <Drawer
      open={!!collection}
      modal
      swipeDirection="right"
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className={cn('justify-start bg-components-panel-bg! p-0! shadow-xl data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:right-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-[calc(100dvh-16px)] data-[swipe-direction=right]:w-[400px] data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-2xl data-[swipe-direction=right]:border-[0.5px] data-[swipe-direction=right]:border-components-panel-border')}>
            <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
              <div className="flex h-full flex-col p-4">
                <div className="shrink-0">
                  <div className="mb-3 flex">
                    <Icon src={collection.icon} />
                    <div className="ml-3 w-0 grow">
                      <div className="flex h-5 items-center">
                        <Title title={collection.label[language]!} />
                      </div>
                      <div className="mt-0.5 mb-1 flex h-4 items-center justify-between">
                        {collection.type === CollectionType.workflow || collection.type === CollectionType.custom
                          ? (
                              <div className="truncate system-xs-regular text-text-tertiary">
                                {collection.author && `${t('author', { ns: 'tools' })} ${collection.author}`}
                              </div>
                            )
                          : (
                              <OrgInfo
                                packageNameClassName="w-auto"
                                orgName={collection.author}
                                packageName={collection.name}
                              />
                            )}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <ActionButton aria-label={t('operation.close', { ns: 'common' })} onClick={onHide}>
                        <RiCloseLine className="size-4" />
                      </ActionButton>
                    </div>
                  </div>
                </div>
                {!!collection.description[language] && (
                  <Description text={collection.description[language]} descriptionLineRows={2}></Description>
                )}
                <div className="-mx-4 flex gap-1 border-b-[0.5px] border-divider-subtle px-4">
                  {collection.type === CollectionType.custom && !isDetailLoading && (
                    <Button
                      className={cn('my-3 w-full shrink-0')}
                      onClick={() => setIsShowEditCustomCollectionModal(true)}
                      disabled={!canManageTools}
                    >
                      <span aria-hidden className="mr-1 i-ri-equalizer-2-line size-4 text-components-button-secondary-text" />
                      <div className="system-sm-medium text-text-secondary">{t('createTool.editAction', { ns: 'tools' })}</div>
                    </Button>
                  )}
                  {collection.type === CollectionType.workflow && !isDetailLoading && customCollection && (
                    <>
                      <Button
                        nativeButton={false}
                        variant="primary"
                        className={cn('my-3 h-8 min-w-0 flex-1 rounded-lg px-3 py-2')}
                        render={<a href={`${basePath}/app/${(customCollection as WorkflowToolProviderResponse).workflow_app_id}/workflow`} rel="noreferrer" target="_blank" />}
                      >
                        <span className="min-w-0 truncate px-0.5 system-sm-medium">{t('openInStudio', { ns: 'tools' })}</span>
                        <span aria-hidden className="i-ri-arrow-right-up-line size-4 shrink-0" />
                      </Button>
                      <Button
                        variant="secondary"
                        className={cn('my-3 h-8 min-w-0 flex-1 rounded-lg px-3 py-2')}
                        onClick={() => setWorkflowToolDrawerOpen(true)}
                        disabled={!canManageTools}
                      >
                        <span aria-hidden className="i-ri-equalizer-2-line size-4 shrink-0 text-components-button-secondary-text" />
                        <span className="min-w-0 truncate px-0.5 system-sm-medium text-components-button-secondary-text">{t('createTool.editAction', { ns: 'tools' })}</span>
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex min-h-0 flex-1 flex-col pt-3">
                  {isDetailLoading && <div className="flex h-[200px]"><Loading type="app" /></div>}
                  {!isDetailLoading && (
                    <>
                      <div className="shrink-0">
                        {(collection.type === CollectionType.builtIn || collection.type === CollectionType.model) && isAuthed && (
                          <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
                            {t('detailPanel.actionNum', { ns: 'plugin', num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' })}
                            {needAuth && (
                              <Button
                                variant="secondary"
                                size="small"
                                onClick={() => {
                                  if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                                    showSettingAuthModal()
                                }}
                                disabled={!canOpenCredentialSettings}
                              >
                                <StatusDot className="mr-2" status="success" />
                                {t('auth.authorized', { ns: 'tools' })}
                              </Button>
                            )}
                          </div>
                        )}
                        {(collection.type === CollectionType.builtIn || collection.type === CollectionType.model) && needAuth && !isAuthed && (
                          <>
                            <div className="system-sm-semibold-uppercase text-text-secondary">
                              <span className="">{t('includeToolNum', { ns: 'tools', num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' }).toLocaleUpperCase()}</span>
                              <span className="px-1">·</span>
                              <span className="text-util-colors-orange-orange-600">{t('auth.setup', { ns: 'tools' }).toLocaleUpperCase()}</span>
                            </div>
                            <Button
                              variant="primary"
                              className={cn('my-3 w-full shrink-0')}
                              onClick={() => {
                                if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                                  showSettingAuthModal()
                              }}
                              disabled={!canOpenCredentialSettings}
                            >
                              {t('auth.unauthorized', { ns: 'tools' })}
                            </Button>
                          </>
                        )}
                        {(collection.type === CollectionType.custom) && (
                          <div className="system-sm-semibold-uppercase text-text-secondary">
                            <span className="">{t('includeToolNum', { ns: 'tools', num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' }).toLocaleUpperCase()}</span>
                          </div>
                        )}
                        {(collection.type === CollectionType.workflow) && (
                          <div className="system-sm-semibold-uppercase text-text-secondary">
                            <span className="">{t('createTool.toolInput.title', { ns: 'tools' }).toLocaleUpperCase()}</span>
                          </div>
                        )}
                      </div>
                      <div className="mt-1 flex-1 overflow-y-auto py-2">
                        {collection.type !== CollectionType.workflow && toolList.map(tool => (
                          <ToolItem
                            key={tool.name}
                            disabled={false}
                            collection={collection}
                            tool={tool}
                            isBuiltIn={isBuiltIn}
                            isModel={isModel}
                          />
                        ))}
                        {collection.type === CollectionType.workflow && (customCollection as WorkflowToolProviderResponse)?.tool?.parameters.map(item => (
                          <div key={item.name} className="mb-1 py-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="code-sm-semibold text-text-secondary">{item.name}</span>
                              <span className="system-xs-regular text-text-tertiary">{item.type}</span>
                              <span className="system-xs-medium text-text-warning-secondary">{item.required ? t('createTool.toolInput.required', { ns: 'tools' }) : ''}</span>
                            </div>
                            <div className="system-xs-regular text-text-tertiary">{item.llm_description}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {showSettingAuth && (
                  <ConfigCredential
                    collection={collection}
                    onCancel={() => setShowSettingAuth(false)}
                    onSaved={async (value) => {
                      if (!canSaveCredentialSettings)
                        return

                      await updateBuiltInToolCredential(collection.name, value)
                      toast.success(t('api.actionSuccess', { ns: 'common' }))
                      await onRefreshData()
                      setShowSettingAuth(false)
                    }}
                    onRemove={async () => {
                      if (!canManageCredential)
                        return

                      await removeBuiltInToolCredential(collection.name)
                      toast.success(t('api.actionSuccess', { ns: 'common' }))
                      await onRefreshData()
                      setShowSettingAuth(false)
                    }}
                    readonly={!canSaveCredentialSettings}
                  />
                )}
                {isShowEditCollectionToolModal && canManageTools && (
                  <EditCustomToolModal
                    payload={customCollection}
                    onHide={() => setIsShowEditCustomCollectionModal(false)}
                    onEdit={doUpdateCustomToolCollection}
                    onRemove={onClickCustomToolDelete}
                  />
                )}
                {workflowToolDrawerOpen && canManageTools && (
                  <WorkflowToolDrawer
                    payload={customCollection as unknown as WorkflowToolDrawerPayload}
                    onHide={() => setWorkflowToolDrawerOpen(false)}
                    onRemove={onClickWorkflowToolDelete}
                    onSave={updateWorkflowToolProvider}
                  />
                )}
                <AlertDialog open={showConfirmDelete} onOpenChange={open => !open && setShowConfirmDelete(false)}>
                  <AlertDialogContent>
                    <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                      <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                        {t('createTool.deleteToolConfirmTitle', { ns: 'tools' })}
                      </AlertDialogTitle>
                      <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                        {t('createTool.deleteToolConfirmContent', { ns: 'tools' })}
                      </AlertDialogDescription>
                    </div>
                    <AlertDialogActions>
                      <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
                      <AlertDialogConfirmButton onClick={handleConfirmDelete}>
                        {t('operation.confirm', { ns: 'common' })}
                      </AlertDialogConfirmButton>
                    </AlertDialogActions>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
export default ProviderDetail
