'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import {
  RiCloseLine,
} from '@remixicon/react'
import { AuthHeaderPrefix, AuthType, CollectionType } from '../types'
import type { Collection, CustomCollectionBackend, Tool, WorkflowToolProviderRequest, WorkflowToolProviderResponse } from '../types'
import ToolItem from './tool-item'
import cn from '@/utils/classnames'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import Confirm from '@/app/components/base/confirm'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { LinkExternal02, Settings01 } from '@/app/components/base/icons/src/vender/line/general'
import Icon from '@/app/components/plugins/card/base/card-icon'
import Title from '@/app/components/plugins/card/base/title'
import OrgInfo from '@/app/components/plugins/card/base/org-info'
import Description from '@/app/components/plugins/card/base/description'
import ConfigCredential from '@/app/components/tools/setting/build-in/config-credentials'
import EditCustomToolModal from '@/app/components/tools/edit-custom-collection-modal'
import WorkflowToolModal from '@/app/components/tools/workflow-tool'
import Toast from '@/app/components/base/toast'
import Drawer from '@/app/components/base/drawer'
import ActionButton from '@/app/components/base/action-button'

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
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Loading from '@/app/components/base/loading'
import { useAppContext } from '@/context/app-context'
import { useInvalidateAllWorkflowTools } from '@/service/use-tools'

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
  const { locale } = useContext(I18n)
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
  const doUpdateCustomToolCollection = async (data: CustomCollectionBackend) => {
    await updateCustomCollection(data)
    onRefreshData()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
  }
  const doRemoveCustomToolCollection = async () => {
    await removeCustomCollection(collection?.name as string)
    onRefreshData()
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
    setIsShowEditCustomCollectionModal(false)
  }
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
      message: t('common.api.actionSuccess'),
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
      message: t('common.api.actionSuccess'),
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
    catch (e) { }
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
      panelClassname={cn('!bg-components-panel-bg border-components-panel-border mb-2 mr-2 mt-[64px] !w-[420px] !max-w-[420px] justify-start rounded-2xl border-[0.5px] !p-0 shadow-xl')}
    >
      <div className='p-4'>
        <div className='mb-3 flex'>
          <Icon src={collection.icon} />
          <div className="ml-3 w-0 grow">
            <div className="flex h-5 items-center">
              <Title title={collection.label[language]} />
            </div>
            <div className='mb-1 flex h-4 items-center justify-between'>
              <OrgInfo
                className="mt-0.5"
                packageNameClassName='w-auto'
                orgName={collection.author}
                packageName={collection.name}
              />
            </div>
          </div>
          <div className='flex gap-1'>
            <ActionButton onClick={onHide}>
              <RiCloseLine className='h-4 w-4' />
            </ActionButton>
          </div>
        </div>
        {!!collection.description[language] && (
          <Description text={collection.description[language]} descriptionLineRows={2}></Description>
        )}
        <div className='border-divider-subtle flex gap-1 border-b-[0.5px]'>
          {collection.type === CollectionType.custom && !isDetailLoading && (
            <Button
              className={cn('my-3 w-full shrink-0')}
              onClick={() => setIsShowEditCustomCollectionModal(true)}
            >
              <Settings01 className='text-text-tertiary mr-1 h-4 w-4' />
              <div className='system-sm-medium text-text-secondary'>{t('tools.createTool.editAction')}</div>
            </Button>
          )}
          {collection.type === CollectionType.workflow && !isDetailLoading && customCollection && (
            <>
              <Button
                variant='primary'
                className={cn('my-3 w-[183px] shrink-0')}
              >
                <a className='text-text-primary flex items-center' href={`/app/${(customCollection as WorkflowToolProviderResponse).workflow_app_id}/workflow`} rel='noreferrer' target='_blank'>
                  <div className='system-sm-medium'>{t('tools.openInStudio')}</div>
                  <LinkExternal02 className='ml-1 h-4 w-4' />
                </a>
              </Button>
              <Button
                className={cn('my-3 w-[183px] shrink-0')}
                onClick={() => setIsShowEditWorkflowToolModal(true)}
                disabled={!isCurrentWorkspaceManager}
              >
                <div className='system-sm-medium text-text-secondary'>{t('tools.createTool.editAction')}</div>
              </Button>
            </>
          )}
        </div>
        {/* Tools */}
        <div className='pt-3'>
          {isDetailLoading && <div className='flex h-[200px]'><Loading type='app' /></div>}
          {/* Builtin type */}
          {!isDetailLoading && (collection.type === CollectionType.builtIn) && isAuthed && (
            <div className='text-text-secondary system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between'>
              {t('plugin.detailPanel.actionNum', { num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' })}
              {needAuth && (
                <Button
                  variant='secondary'
                  size='small'
                  onClick={() => {
                    if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                      showSettingAuthModal()
                  }}
                  disabled={!isCurrentWorkspaceManager}
                >
                  <Indicator className='mr-2' color={'green'} />
                  {t('tools.auth.authorized')}
                </Button>
              )}
            </div>
          )}
          {!isDetailLoading && (collection.type === CollectionType.builtIn) && needAuth && !isAuthed && (
            <>
              <div className='text-text-secondary system-sm-semibold-uppercase'>
                <span className=''>{t('tools.includeToolNum', { num: toolList.length, action: toolList.length > 1 ? 'actions' : 'action' }).toLocaleUpperCase()}</span>
                <span className='px-1'>·</span>
                <span className='text-util-colors-orange-orange-600'>{t('tools.auth.setup').toLocaleUpperCase()}</span>
              </div>
              <Button
                variant='primary'
                className={cn('my-3 w-full shrink-0')}
                onClick={() => {
                  if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
                    showSettingAuthModal()
                }}
                disabled={!isCurrentWorkspaceManager}
              >
                {t('tools.auth.unauthorized')}
              </Button>
            </>
          )}
          {/* Custom type */}
          {!isDetailLoading && (collection.type === CollectionType.custom) && (
            <div className='text-text-secondary system-sm-semibold-uppercase'>
              <span className=''>{t('tools.includeToolNum', { num: toolList.length }).toLocaleUpperCase()}</span>
            </div>
          )}
          {/* Workflow type */}
          {!isDetailLoading && (collection.type === CollectionType.workflow) && (
            <div className='text-text-secondary system-sm-semibold-uppercase'>
              <span className=''>{t('tools.createTool.toolInput.title').toLocaleUpperCase()}</span>
            </div>
          )}
          {!isDetailLoading && (
            <div className='mt-1 py-2'>
              {collection.type !== CollectionType.workflow && toolList.map(tool => (
                <ToolItem
                  key={tool.name}
                  disabled={false}
                  // disabled={needAuth && (isBuiltIn || isModel) && !isAuthed}
                  collection={collection}
                  tool={tool}
                  isBuiltIn={isBuiltIn}
                  isModel={isModel}
                />
              ))}
              {collection.type === CollectionType.workflow && (customCollection as WorkflowToolProviderResponse)?.tool?.parameters.map(item => (
                <div key={item.name} className='mb-1 py-1'>
                  <div className='mb-1 flex items-center gap-2'>
                    <span className='text-text-secondary code-sm-semibold'>{item.name}</span>
                    <span className='text-text-tertiary system-xs-regular'>{item.type}</span>
                    <span className='text-text-warning-secondary system-xs-medium'>{item.required ? t('tools.createTool.toolInput.required') : ''}</span>
                  </div>
                  <div className='text-text-tertiary system-xs-regular'>{item.llm_description}</div>
                </div>
              ))}
            </div>
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
                message: t('common.api.actionSuccess'),
              })
              await onRefreshData()
              setShowSettingAuth(false)
            }}
            onRemove={async () => {
              await removeBuiltInToolCredential(collection.name)
              Toast.notify({
                type: 'success',
                message: t('common.api.actionSuccess'),
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
            payload={customCollection}
            onHide={() => setIsShowEditWorkflowToolModal(false)}
            onRemove={onClickWorkflowToolDelete}
            onSave={updateWorkflowToolProvider}
          />
        )}
        {showConfirmDelete && (
          <Confirm
            title={t('tools.createTool.deleteToolConfirmTitle')}
            content={t('tools.createTool.deleteToolConfirmContent')}
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
