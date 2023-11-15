import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type {
  FormValue,
  ProviderConfigModal,
  ProviderEnum,
} from './declarations'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import SystemModel from './system-model'
import config from './configs'
import { ConfigurableProviders } from './utils'
import {
  changeModelProviderPriority,
  deleteModelProvider,
  deleteModelProviderModel,
  fetchModelProviders,
  setModelProvider,
} from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'
import Confirm from '@/app/components/base/confirm/common'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import I18n from '@/context/i18n'

const MODEL_CARD_LIST = [
  config.openai,
  config.anthropic,
]

type DeleteModel = {
  model_name: string
  model_type: string
}

const ModelPage = () => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const {
    updateModelList,
  } = useProviderContext()
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const [showModal, setShowModal] = useState(false)
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [modelModalConfig, setModelModalConfig] = useState<ProviderConfigModal | undefined>(undefined)
  const [confirmShow, setConfirmShow] = useState(false)
  const [deleteModel, setDeleteModel] = useState<DeleteModel & { providerKey: ProviderEnum }>()
  const [modalMode, setModalMode] = useState('add')

  let modelList = []

  if (locale === 'en') {
    modelList = [
      config.azure_openai,
      config.replicate,
      config.huggingface_hub,
      config.cohere,
      config.zhipuai,
      config.baichuan,
      config.spark,
      config.minimax,
      config.tongyi,
      config.wenxin,
      config.chatglm,
      config.xinference,
      config.openllm,
      config.localai,
    ]
  }
  else {
    modelList = [
      config.huggingface_hub,
      config.cohere,
      config.zhipuai,
      config.spark,
      config.baichuan,
      config.minimax,
      config.azure_openai,
      config.replicate,
      config.tongyi,
      config.wenxin,
      config.chatglm,
      config.xinference,
      config.openllm,
      config.localai,
    ]
  }

  const handleOpenModal = (newModelModalConfig: ProviderConfigModal | undefined, editValue?: FormValue) => {
    if (newModelModalConfig) {
      setShowModal(true)
      const defaultValue = editValue ? { ...newModelModalConfig.defaultValue, ...editValue } : newModelModalConfig.defaultValue
      setModelModalConfig({
        ...newModelModalConfig,
        defaultValue,
      })
      if (editValue)
        setModalMode('edit')
      else
        setModalMode('add')
    }
  }
  const handleCancelModal = () => {
    setShowModal(false)
  }
  const handleUpdateProvidersAndModelList = () => {
    updateModelList(ModelType.textGeneration)
    updateModelList(ModelType.embeddings)
    updateModelList(ModelType.speech2text)
    updateModelList(ModelType.reranking)
    mutateProviders()
  }
  const handleSave = async (originValue?: FormValue) => {
    if (originValue && modelModalConfig) {
      const v = modelModalConfig.filterValue ? modelModalConfig.filterValue(originValue) : originValue
      let body, url
      if (ConfigurableProviders.includes(modelModalConfig.key)) {
        const { model_name, model_type, ...config } = v
        body = {
          model_name,
          model_type,
          config,
        }
        url = `/workspaces/current/model-providers/${modelModalConfig.key}/models`
      }
      else {
        body = {
          config: v,
        }
        url = `/workspaces/current/model-providers/${modelModalConfig.key}`
      }

      try {
        eventEmitter?.emit('provider-save')
        const res = await setModelProvider({ url, body })
        if (res.result === 'success') {
          notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
          handleUpdateProvidersAndModelList()
          handleCancelModal()
        }
        eventEmitter?.emit('')
      }
      catch (e) {
        eventEmitter?.emit('')
      }
    }
  }

  const handleConfirm = (deleteModel: DeleteModel, providerKey: ProviderEnum) => {
    setDeleteModel({ ...deleteModel, providerKey })
    setConfirmShow(true)
  }

  const handleOperate = async ({ type, value }: Record<string, any>, provierKey: ProviderEnum) => {
    if (type === 'delete') {
      if (!value) {
        const res = await deleteModelProvider({ url: `/workspaces/current/model-providers/${provierKey}` })
        if (res.result === 'success') {
          notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
          handleUpdateProvidersAndModelList()
        }
      }
      else {
        handleConfirm(value, provierKey)
      }
    }

    if (type === 'priority') {
      const res = await changeModelProviderPriority({
        url: `/workspaces/current/model-providers/${provierKey}/preferred-provider-type`,
        body: {
          preferred_provider_type: value,
        },
      })
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        mutateProviders()
      }
    }
  }

  const handleDeleteModel = async () => {
    const { model_name, model_type, providerKey } = deleteModel || {}
    const res = await deleteModelProviderModel({
      url: `/workspaces/current/model-providers/${providerKey}/models?model_name=${model_name}&model_type=${model_type}`,
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      setConfirmShow(false)
      handleUpdateProvidersAndModelList()
    }
  }

  return (
    <div className='relative pt-1 -mt-2'>
      <div className='flex items-center justify-between mb-2 h-8'>
        <div className='text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
        <SystemModel />
      </div>
      <div className='grid grid-cols-2 gap-4 mb-6'>
        {
          MODEL_CARD_LIST.map((model, index) => (
            <ModelCard
              key={index}
              modelItem={model.item}
              currentProvider={providers?.[model.item.key]}
              onOpenModal={editValue => handleOpenModal(model.modal, editValue)}
              onOperate={v => handleOperate(v, model.item.key)}
            />
          ))
        }
      </div>
      {
        modelList.map((model, index) => (
          <ModelItem
            key={index}
            modelItem={model.item}
            currentProvider={providers?.[model.item.key]}
            onOpenModal={editValue => handleOpenModal(model.modal, editValue)}
            onOperate={v => handleOperate(v, model.item.key)}
            onUpdate={mutateProviders}
          />
        ))
      }
      <ModelModal
        isShow={showModal}
        modelModal={modelModalConfig}
        onCancel={handleCancelModal}
        onSave={handleSave}
        mode={modalMode}
      />
      <Confirm
        isShow={confirmShow}
        onCancel={() => setConfirmShow(false)}
        title={deleteModel?.model_name || ''}
        desc={t('common.modelProvider.item.deleteDesc', { modelName: deleteModel?.model_name }) || ''}
        onConfirm={handleDeleteModel}
        confirmWrapperClassName='!z-30'
      />
    </div>
  )
}

export default ModelPage
