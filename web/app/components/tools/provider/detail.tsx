'use client'
import type { Collection, CustomCollectionBackend, Tool, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '../types'
import type { WorkflowToolModalPayload } from '@/app/components/tools/workflow-tool'
import {
  RiCloseLine,
} from '@remixicon/react'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import Drawer from '@/app/components/base/drawer'
import { LinkExternal02, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import Loading from '@/app/components/base/loading'
import Toast from '@/app/components/base/toast'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Indicator from '@/app/components/header/indicator'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Description from '@/app/components/plugins/card/base/description'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import Title from '@/app/components/plugins/card/base/title'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import { useAppContext } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'

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
import { cn } from '@/utils/classnames'
import { basePath } from '@/utils/var'
import { AuthHeaderPrefix, AuthType, CollectionType } from '../types'
import ToolItem from './tool-item'

type Props = {
  collection: Collection
  onHide: () => void
  onRefreshData: () => void
}

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
  const { isCurrentWorkspaceManager } = useAppContext()
  const invalidateAllWorkflowTools = useInvalidateAllWorkflowTools()
  const [isDetailLoading, setIsDetailLoading] = useState(false)

  // built in provider
  const [showSettingAuth, setShowSettingAuth] = useState(false)
  const { setShowModelModal } = useModalContext()
  const { modelProviders: providers } = useProviderContext()
  const showSettingAuthModal = () => {
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
  }, [collection.labels, collection.name])

  const doUpdateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await updateCustomCollection(data)
    onRefreshData()
    await getCustomProvider()
    // Use fresh data from form submission to avoid race condition with collection.labels
    setCustomCollection(prev => prev ? { ...prev, labels: data.labels } : null)
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
    setIsShowEditCustomCollectionModal(false)
  }
  const doRemoveCustomToolCollection = async () => {
    await removeCustomCollection(collection?.name as string)
    onRefreshData()
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
    setIsShowEditCustomCollectionModal(false)
  }
  // workflow provider
  const [isShowEditWorkflowToolModal, setIsShowEditWorkflowToolModal] = useState(false)
  const getWorkflowToolProvider = useCallback(async () => {
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
  }, [collection.id])
  const removeWorkflowToolProvider = async () => {
    await deleteWorkflowTool(collection.id)
    onRefreshData()
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
    setIsShowEditWorkflowToolModal(false)
  }
  const updateWorkflowToolProvider = async (data: WorkflowToolProviderRequest & Partial<{
    workflow_app_id: string
    workflow_tool_id: string
  }>) => {
    await saveWorkflowToolProvider(data)
    invalidateAllWorkflowTools()
    onRefreshData()
    getWorkflowToolProvider()
    Toast.notify({
      type: 'success',
      message: t('api.actionSuccess', { ns: 'common' }),
    })
    setIsShowEditWorkflowToolModal(false)
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
        const list = await fetchCustomToolList(collection.name)
        setToolList(list)
      }
    }
    catch { }
    setIsDetailLoading(false)
  }, [collection.name, collection.type])

  useEffect(() => {
    if (collection.type === CollectionType.custom)
      getCustomProvider()
    if (collection.type === CollectionType.workflow)
      getWorkflowToolProvider()
    getProviderToolList()
  }, [collection.name, collection.type, getCustomProvider, getProviderToolList, getWorkflowToolProvider])

  return (
    <Drawer
      isOpen={!!collection}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassName={cn('mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] border-components-panel-border !bg-components-panel-bg !p-0 shadow-xl')}
    >
      <div className="flex h-full flex-col p-4">
        <div className="shrink-0">
          <div className="mb-3 flex">
            <Icon src={collection.icon} />
            <div className="ml-3 w-0 grow">
              <div className="flex h-5 items-center">
                <Title title={collection.label[language]} />
              </div>
              <div className="mb-1 mt-0.5 flex h-4 items-center justify-between">
                <OrgInfo
                  packageNameClassName="w-auto"
                  orgName={collection.author}
                  packageName={collection.name}
                />
              </div>
            </div>
            <div className="flex gap-1">
              <ActionButton onClick={onHide}>
                <RiCloseLine className="h-4 w-4" />
              </ActionButton>
            </div>
          </div>
        </div>
        {!!collection.description[language] && (
          <Description text={collection.description[language]} descriptionLineRows={2}></Description>
        )}
        <div className="flex gap-1 border-b-[0.5px] border-divider-subtle">
          {collection.type === CollectionType.custom && !isDetailLoading && (
            <Button
              className={cn('my-3 w-full shrink-0')}
              onClick={() => setIsShowEditCustomCollectionModal(true)}
            >
              <Settings01 className="mr-1 h-4 w-4 text-text-tertiary" />
              <div className="system-sm-medium text-text-secondary">{t('createTool.editAction', { ns: 'tools' })}</div>
            </Button>
          )}
          {collection.type === CollectionType.workflow && !isDetailLoading && customCollection && (
            <>
              <Button
                variant="primary"
                className={cn('my-3 w-[183px] shrink-0')}
              >
                <a className="flex items-center" href={`${basePath}/app/${(customCollection as WorkflowToolProviderResponse).workflow_app_id}/workflow`} rel="noreferrer" target="_blank">
                  <div className="system-sm-medium">{t('openInStudio', { ns: 'tools' })}</div>
                  <LinkExternal02 className="ml-1 h-4 w-4" />
                </a>
              </Button>
              <Button
                className={cn('my-3 w-[183px] shrink-0')}
                onClick={() => setIsShowEditWorkflowToolModal(true)}
                disabled={!isCurrentWorkspaceManager}
              >
                <div className="system-sm-medium text-text-secondary">{t('createTool.editAction', { ns: 'tools' })}</div>
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
                  <div className="system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary">
                    {t('detailPanel.actionNum', { ns: 'plugin', num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' })}
                    {needAuth && (
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => {
                          if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                            showSettingAuthModal()
                        }}
                        disabled={!isCurrentWorkspaceManager}
                      >
                        <Indicator className="mr-2" color="green" />
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
                      disabled={!isCurrentWorkspaceManager}
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
              await updateBuiltInToolCredential(collection.name, value)
              Toast.notify({
                type: 'success',
                message: t('api.actionSuccess', { ns: 'common' }),
              })
              await onRefreshData()
              setShowSettingAuth(false)
            }}
            onRemove={async () => {
              await removeBuiltInToolCredential(collection.name)
              Toast.notify({
                type: 'success',
                message: t('api.actionSuccess', { ns: 'common' }),
              })
              await onRefreshData()
              setShowSettingAuth(false)
            }}
          />
        )}
        {isShowEditCollectionToolModal && (
          <EditCustomToolModal
            payload={customCollection}
            onHide={() => setIsShowEditCustomCollectionModal(false)}
            onEdit={doUpdateCustomToolCollection}
            onRemove={onClickCustomToolDelete}
          />
        )}
        {isShowEditWorkflowToolModal && (
          <WorkflowToolModal
            payload={customCollection as unknown as WorkflowToolModalPayload}
            onHide={() => setIsShowEditWorkflowToolModal(false)}
            onRemove={onClickWorkflowToolDelete}
            onSave={updateWorkflowToolProvider}
          />
        )}
        {showConfirmDelete && (
          <Confirm
            title={t('createTool.deleteToolConfirmTitle', { ns: 'tools' })}
            content={t('createTool.deleteToolConfirmContent', { ns: 'tools' })}
            isShow={showConfirmDelete}
            onConfirm={handleConfirmDelete}
            onCancel={() => setShowConfirmDelete(false)}
          />
        )}
      </div>
    </Drawer>
  )
}
export default ProviderDetail
