import { useState } from 'react'
import useSWR from 'swr'
import { useTranslation } from 'react-i18next'
import type {
  FormValue,
  ProviderConfigModal,
} from './declarations'
import { ProviderEnum } from './declarations'
import ModelSelector from './model-selector'
import ModelCard from './model-card'
import ModelItem from './model-item'
import ModelModal from './model-modal'
import config from './configs'
import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
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

const MODEL_CARD_LIST = [
  config.openai,
  config.anthropic,
]

const MODEL_LIST = [
  config.azure_openai,
  config.replicate,
  config.huggingface_hub,
  config.tongyi,
  config.spark,
  config.minimax,
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
  const { data: providers, mutate: mutateProviders } = useSWR('/workspaces/current/model-providers', fetchModelProviders)
  console.log(providers)
  const [showMoreModel, setShowMoreModel] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const [modelModalConfig, setModelModalConfig] = useState<ProviderConfigModal | undefined>(undefined)
  const [confirmShow, setConfirmShow] = useState(false)
  const [deleteModel, setDeleteModel] = useState<DeleteModel & { providerKey: ProviderEnum }>()

  const handleOpenModal = (newModelModalConfig: ProviderConfigModal | undefined, editValue?: FormValue) => {
    if (newModelModalConfig) {
      setShowModal(true)
      const defaultValue = editValue ? { ...newModelModalConfig.defaultValue, ...editValue } : newModelModalConfig.defaultValue
      setModelModalConfig({ ...newModelModalConfig, defaultValue })
    }
  }
  const handleCancelModal = () => {
    setShowModal(false)
  }
  const handleSave = async (v?: FormValue) => {
    if (v && modelModalConfig) {
      let body, url
      if ([ProviderEnum.azure_openai, ProviderEnum.replicate, ProviderEnum.huggingface_hub].includes(modelModalConfig.key)) {
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
          mutateProviders()
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
          mutateProviders()
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
      url: `/workspaces/current/model-providers/${providerKey}/models`,
      body: {
        model_name,
        model_type,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      mutateProviders()
    }
  }

  return (
    <div className='pt-1 -mt-2'>
      <div className='grid grid-cols-3 gap-4 mb-5'>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.systemReasoningModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector
              value={undefined}
              modelType={ModelType.textGeneration}
              onChange={() => {}}
            />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.embeddingModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector
              value={undefined}
              modelType={ModelType.embeddings}
              onChange={() => {}}
            />
          </div>
        </div>
        <div className='w-full'>
          <div className={titleClassName}>
            {t('common.modelProvider.speechToTextModel.key')}
            <HelpCircle className={tipClassName} />
          </div>
          <div>
            <ModelSelector
              value={undefined}
              modelType={ModelType.speech2text}
              onChange={() => {}}
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
