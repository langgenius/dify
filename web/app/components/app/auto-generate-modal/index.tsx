import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import useBoolean from 'ahooks/lib/useBoolean'
import { useTranslation } from 'react-i18next'
import { generateWorkflow } from '@/service/debug'
import { type Model, ModelModeType } from '@/types/app'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { useContext } from 'use-context-selector'

import Loading from '@/app/components/base/loading'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { importDSL } from '@/service/apps'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import { useAppContext } from '@/context/app-context'
import { useRouter } from 'next/navigation'
import { ToastContext } from '../../base/toast'
import Generator from '../../base/icons/src/vender/other/Generator'
export type IGetCodeGeneratorResProps = {
  isShow: boolean
  onClose: () => void
  onSuccess?: () => void
}

export const AutoGenerateModal: FC<IGetCodeGeneratorResProps> = (
  {
    isShow,
    onClose,
    onSuccess,
  },
) => {
  const { notify } = useContext(ToastContext)

  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const { t } = useTranslation()
  const { push } = useRouter()

  const [instruction, setInstruction] = React.useState<string>('')
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const { isCurrentWorkspaceEditor } = useAppContext()
  const [res, setRes] = React.useState<string | null>(null)
  const isValid = () => {
    if (instruction.trim() === '') {
      notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: t('appDebug.code.instruction'),
        }),
      })
      return false
    }
    return true
  }
  const model: Model = {
    provider: currentProvider?.provider || '',
    name: currentModel?.model || '',
    mode: ModelModeType.chat,
    // This is a fixed parameter
    completion_params: {
      temperature: 0.7,
      max_tokens: 0,
      top_p: 0,
      echo: false,
      stop: [],
      presence_penalty: 0,
      frequency_penalty: 0,
    },
  }
  const isInLLMNode = true
  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      const res = await generateWorkflow({
        instruction,
        model_config: model,
      })
      setRes(res)
    }
    finally {
      setLoadingFalse()
    }
  }

  const renderLoading = (
    <div className='w-0 grow flex flex-col items-center justify-center h-full space-y-3'>
      <Loading />
      <div className='text-[13px] text-gray-400'>{t('appDebug.autoGenerate.loading')}</div>
    </div>
  )
  const renderNoData = (
    <div className='w-0 grow flex flex-col items-center px-8 justify-center h-full space-y-3'>
      <Generator className='w-14 h-14 text-gray-300' />
      <div className='leading-5 text-center text-[13px] font-normal text-gray-400'>
        <div>{t('appDebug.autoGenerate.noDataLine1')}</div>
        <div>{t('appDebug.autoGenerate.noDataLine2')}</div>
      </div>
    </div>
  )

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='!p-0 min-w-[1140px]'
      closable
    >
      <div className='relative flex h-[680px] flex-wrap'>
        <div className='w-[570px] shrink-0 p-8 h-full overflow-y-auto border-r border-gray-100'>
          <div className='mb-8'>
            <div className={'leading-[28px] text-lg font-bold'}>{t('appDebug.autoGenerate.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-gray-500'>{t('appDebug.autoGenerate.description')}</div>
          </div>
          <div className='flex items-center'>
            <ModelIcon
              className='shrink-0 mr-1.5'
              provider={currentProvider}
              modelName={currentModel?.model}
            />
            <ModelName
              className='grow'
              modelItem={currentModel!}
              showMode
              showFeatures
            />
          </div>
          <div className='mt-6'>
            <div className='text-[0px]'>
              <div className='mb-2 leading-5 text-sm font-medium text-gray-900'>{t('appDebug.autoGenerate.instruction')}</div>
              <textarea
                className="w-full h-[200px] overflow-y-auto px-3 py-2 text-sm bg-gray-50 rounded-lg"
                placeholder={t('appDebug.autoGenerate.instructionPlaceholder') || ''}
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
              />
            </div>

            <div className='mt-5 flex justify-end'>
              <Button
                className='flex space-x-1'
                variant='primary'
                onClick={onGenerate}
                disabled={isLoading}
              >
                <Generator className='w-4 h-4 text-white' />
                <span className='text-xs font-semibold text-white'>{t('appDebug.autoGenerate.generate')}</span>
              </Button>
            </div>
          </div>
        </div>
        {isLoading && renderLoading}
        {!isLoading && !res && renderNoData}
        {(!isLoading && res) && (
          <div className='w-0 grow p-6 pb-0 h-full'>
            <div className='shrink-0 mb-3 leading-[160%] text-base font-semibold text-gray-800'>{t('appDebug.autoGenerate.resTitle')}</div>
            <div className={cn('max-h-[555px] overflow-y-auto', !isInLLMNode && 'pb-2')}>
              {res}
            </div>

            <div className='flex justify-end py-4 bg-white'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' className='ml-2' onClick={async () => {
                const response = await importDSL({
                  mode: DSLImportMode.YAML_CONTENT,
                  yaml_content: res || '',
                })
                if (!response)
                  return

                const { status, app_id } = response
                if (status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS) {
                  if (onSuccess)
                    onSuccess()
                }
                notify({
                  type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
                  message: t(status === DSLImportStatus.COMPLETED ? 'app.newApp.appCreated' : 'app.newApp.caution'),
                  children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS && t('app.newApp.appCreateDSLWarning'),
                })
                localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
                getRedirection(isCurrentWorkspaceEditor, { id: app_id }, push)
              }}>{t('appDebug.autoGenerate.apply')}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default React.memo(AutoGenerateModal)
