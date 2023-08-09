import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import Indicator from '../../../indicator'
import type { CustomAddProvider, CustomConfigurableProvider, CustomFixedProvider, CustomSetupProvider, ModelItem as TModelItem } from '../declarations'
import Operation from './Operation'
import s from './index.module.css'
import I18n from '@/context/i18n'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm/common'
import { deleteModelProviderModel } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'
import { useProviderContext } from '@/context/provider-context'

type ModelItemProps = {
  currentProvider: CustomAddProvider | CustomSetupProvider
  modelItem: TModelItem
  onOpenModal: () => void
}

type DeleteModel = {
  model_name: string
  model_type: string
}

const ModelItem: FC<ModelItemProps> = ({
  currentProvider,
  modelItem,
  onOpenModal,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const { mutateProviders } = useProviderContext()
  const { notify } = useToastContext()
  const [confirmShow, setConfirmShow] = useState(false)
  const [deleteModel, setDeleteModel] = useState<DeleteModel>()
  const configurable = currentProvider?.model_flexibility === 'configurable'
  const selfProvider = currentProvider?.providers[0]

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
      mutateProviders()
    }
  }

  return (
    <div className='mb-2 bg-gray-50 rounded-xl'>
      <div className='flex justify-between items-center px-4 h-14'>
        {modelItem.titleIcon[locale]}
        <div className='flex items-center'>
          {
            modelItem.vender && (
              <div className='flex items-center'>
                📣
                <div className={`${s.vender} ml-1 mr-2 text-xs font-medium text-transparent`}>{modelItem.vender?.[locale]}</div>
                <Button
                  type='primary'
                  className='!px-3 !h-7 rounded-md !text-xs font-medium text-gray-700'
                  onClick={onOpenModal}
                >
                  Get for free
                </Button>
                <div className='mx-2 w-[1px] h-4 bg-black/5' />
              </div>
            )
          }
          {
            modelItem.disable && (
              <div className='flex items-center text-xs text-gray-500'>
                {modelItem.disable.tip[locale]}
                <a
                  className={`${locale === 'en' && 'ml-1'} text-primary-600 cursor-pointer`}
                  href={modelItem.disable.link.href[locale]}
                  target='_blank'
                >
                  {modelItem.disable.link.label[locale]}
                </a>
                <div className='mx-2 w-[1px] h-4 bg-black/5' />
              </div>
            )
          }
          {
            configurable && (
              <Button
                className={`!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700 ${!!modelItem.disable && '!text-gray-300'}`}
                onClick={onOpenModal}
                disabled={!!modelItem.disable}
              >
                {t('common.operation.add')}
              </Button>
            )
          }
          {
            !configurable && !(selfProvider as CustomFixedProvider)?.config && (
              <Button
                className={`!px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700 ${!!modelItem.disable && '!text-gray-300'}`}
                onClick={onOpenModal}
                disabled={!!modelItem.disable}
              >
                {t('common.operation.setup')}
              </Button>
            )
          }
          {
            !configurable && (selfProvider as CustomFixedProvider)?.config && (
              <div className='flex items-center'>
                <Indicator className='mr-3' />
                <Button
                  className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
                  onClick={onOpenModal}
                >
                  {t('common.operation.edit')}
                </Button>
                <Operation onOperate={() => setConfirmShow(true)} />
              </div>
            )
          }
        </div>
      </div>
      {
        configurable && !!(selfProvider as CustomConfigurableProvider)?.models?.length && (
          <div className='px-3 pb-3'>
            {
              (selfProvider as CustomConfigurableProvider)?.models.map(selfModel => (
                <div className='flex mb-1 px-3 py-2 bg-white rounded-lg shadow-xs last:mb-0'>
                  <div className='grow'>
                    <div className='flex items-center mb-0.5 h-[18px] text-[13px] font-medium text-gray-700'>
                      {selfModel.model_name}
                      <div className='ml-2 px-1.5 rounded-md border border-[rgba(0,0,0,0.08)] text-xs text-gray-600'>{selfModel.model_type}</div>
                    </div>
                    <div className='text-xs text-gray-500'>version: {selfModel.config.model_version}</div>
                  </div>
                  <div className='flex items-center'>
                    <Indicator className='mr-3' />
                    <Button
                      className='mr-1 !px-3 !h-7 rounded-md bg-white !text-xs font-medium text-gray-700'
                      onClick={onOpenModal}
                    >
                      {t('common.operation.edit')}
                    </Button>
                    <Operation onOperate={() => handleConfirm(selfModel)} />
                  </div>
                </div>
              ))
            }
          </div>
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
