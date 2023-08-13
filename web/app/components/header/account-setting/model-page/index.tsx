import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  BackendModel,
  FormValue,
  ProviderConfigModal,
  ProviderEnum,
} from './declarations'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import config from './configs'
import { ConfigurableProviders } from './utils'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import {
  changeModelProviderPriority,
  deleteModelProvider,
  deleteModelProviderModel,
  fetchDefaultModal,
  fetchModelProviders,
  setModelProvider,
  updateDefaultModel,
} from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'
import Confirm from '@/app/components/base/confirm/common'
import { ModelType } from '@/app/components/header/account-setting/model-page/declarations'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import Tooltip from '@/app/components/base/tooltip'

const MODEL_CARD_LIST = [
  config.openai,
  config.anthropic,
]

const MODEL_LIST = [
  config.azure_openai,
  config.replicate,
  config.huggingface_hub,
  config.minimax,
  config.spark,
  config.tongyi,
  config.wenxin,
  config.chatglm,
]

const titleClassName = `
flex items-center h-9 text-sm font-medium text-gray-900
`
const tipClassName = `
ml-0.5 w-[14px] h-[14px] text-gray-400
`

type DeleteModel = {
  model_name: string
  model_type: string
}

const ModelPage = () => {
  const { t } = useTranslation()
  const { updateModelList } = useProviderContext()
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  const { data: textGenerationDefaultModel, mutate: mutateTextGenerationDefaultModel } = useSWR('/workspaces/current/default-model?model_type=text-generation', fetchDefaultModal)
  const { data: embeddingsDefaultModel, mutate: mutateEmbeddingsDefaultModel } = useSWR('/workspaces/current/default-model?model_type=embeddings', fetchDefaultModal)
  const { data: speech2textDefaultModel, mutate: mutateSpeech2textDefaultModel } = useSWR('/workspaces/current/default-model?model_type=speech2text', fetchDefaultModal)
  const [showMoreModel, setShowMoreModel] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [modelModalConfig, setModelModalConfig] = useState<ProviderConfigModal | undefined>(undefined)
  const [confirmShow, setConfirmShow] = useState(false)
  const [deleteModel, setDeleteModel] = useState<DeleteModel & { providerKey: ProviderEnum }>()
  const [modalMode, setModalMode] = useState('add')

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
    mutateProviders()
  }
  const handleSave = async (v?: FormValue) => {
    if (v && modelModalConfig) {
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

  const mutateDefaultModel = (type: ModelType) => {
    if (type === ModelType.textGeneration)
      mutateTextGenerationDefaultModel()
    if (type === ModelType.embeddings)
      mutateEmbeddingsDefaultModel()
    if (type === ModelType.speech2text)
      mutateSpeech2textDefaultModel()
  }
  const handleChangeDefaultModel = async (type: ModelType, v: BackendModel) => {
    const res = await updateDefaultModel({
      url: '/workspaces/current/default-model',
      body: {
        model_type: type,
        provider_name: v.model_provider.provider_name,
        model_name: v.model_name,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateDefaultModel(type)
    }
  }

  return (
    <div className='relative pt-1 -mt-2'>
      <div className='grid grid-cols-3 gap-4 mb-5'>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.systemReasoningModel.key')}
            <Tooltip
              selector='model-page-system-reasoning-model-tip'
              htmlContent={
                <div className='w-[261px] text-gray-500'>{t('common.modelProvider.systemReasoningModel.tip')}</div>
              }
            >
              <HelpCircle className={tipClassName} />
            </Tooltip>
          </div>
          <div>
            <ModelSelector
              value={textGenerationDefaultModel && { providerName: textGenerationDefaultModel.model_provider.provider_name, modelName: textGenerationDefaultModel.model_name }}
              modelType={ModelType.textGeneration}
              onChange={v => handleChangeDefaultModel(ModelType.textGeneration, v)}
            />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.embeddingModel.key')}
            <Tooltip
              selector='model-page-system-embedding-model-tip'
              htmlContent={
                <div className='w-[261px] text-gray-500'>{t('common.modelProvider.embeddingModel.tip')}</div>
              }
            >
              <HelpCircle className={tipClassName} />
            </Tooltip>
          </div>
          <div>
            <ModelSelector
              value={embeddingsDefaultModel && { providerName: embeddingsDefaultModel.model_provider.provider_name, modelName: embeddingsDefaultModel.model_name }}
              modelType={ModelType.embeddings}
              onChange={v => handleChangeDefaultModel(ModelType.embeddings, v)}
            />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.speechToTextModel.key')}
            <Tooltip
              selector='model-page-system-speechToText-model-tip'
              htmlContent={
                <div className='w-[261px] text-gray-500'>{t('common.modelProvider.speechToTextModel.tip')}</div>
              }
            >
              <HelpCircle className={tipClassName} />
            </Tooltip>
          </div>
          <div>
            <ModelSelector
              value={speech2textDefaultModel && { providerName: speech2textDefaultModel.model_provider.provider_name, modelName: speech2textDefaultModel.model_name }}
              modelType={ModelType.speech2text}
              onChange={v => handleChangeDefaultModel(ModelType.speech2text, v)}
            />
          </div>
        </div>
      </div>
      <div className='mb-5 h-[0.5px] bg-gray-100' />
      <div className='mb-3 text-sm font-medium text-gray-800'>{t('common.modelProvider.models')}</div>
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
        MODEL_LIST.slice(0, showMoreModel ? MODEL_LIST.length : 3).map((model, index) => (
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
      {
        !showMoreModel && (
          <div className='inline-flex items-center px-1 h-[26px] cursor-pointer' onClick={() => setShowMoreModel(true)}>
            <ChevronDownDouble className='mr-1 w-3 h-3 text-gray-500' />
            <div className='text-xs font-medium text-gray-500'>{t('common.modelProvider.showMoreModelProvider')}</div>
          </div>
        )
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
      />
    </div>
  )
}

export default ModelPage
