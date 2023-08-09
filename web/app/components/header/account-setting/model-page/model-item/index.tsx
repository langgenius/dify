import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import type { ModelItem as TModelItem, TModelProvider } from '../declarations'
import Setting from './Setting'
import Card from './Card'
import I18n from '@/context/i18n'
import Confirm from '@/app/components/base/confirm/common'
import { deleteModelProviderModel } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'

type ModelItemProps = {
  currentProvider?: TModelProvider
  modelItem: TModelItem
  onOpenModal: () => void
  onUpdate: () => void
}

type DeleteModel = {
  model_name: string
  model_type: string
}

const ModelItem: FC<ModelItemProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
  onUpdate,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const [confirmShow, setConfirmShow] = useState(false)
  const [deleteModel, setDeleteModel] = useState<DeleteModel>()
  const configurable = currentProvider?.model_flexibility === 'configurable'
  const custom = currentProvider?.providers.find(p => p.provider_type === 'custom')

  const handleConfirm = (deleteModel: DeleteModel) => {
    setDeleteModel(deleteModel)
    setConfirmShow(true)
  }

  const handleDeleteModel = async () => {
    const { model_name, model_type } = deleteModel || {}
    const res = await deleteModelProviderModel({
      url: `/workspaces/current/model-providers/${modelItem.key}/models`,
      body: {
        model_name,
        model_type,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      onUpdate()
    }
  }

  return (
    <div className='mb-2 bg-gray-50 rounded-xl'>
      <div className='flex justify-between items-center px-4 h-14'>
        {modelItem.titleIcon[locale]}
        <Setting
          currentProvider={currentProvider}
          modelItem={modelItem}
          onOpenModal={onOpenModal}
          onOperate={() => {}}
        />
      </div>
      {
        !!custom?.models?.length && (
          <Card models={custom?.models} onOpenModal={() => {}} />
        )
      }
      <Confirm
        isShow={confirmShow}
        onCancel={() => setConfirmShow(false)}
        title={deleteModel?.model_name || ''}
        desc='al6z-infra/llama136-v2-chat are being used as system reasoning models. Some functions will not be available after removal. Please confirm.'
        onConfirm={handleDeleteModel}
      />
    </div>
  )
}

export default ModelItem
