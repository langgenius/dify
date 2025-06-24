import type { FC } from 'react'
import React, { useCallback, useEffect } from 'react'
import cn from 'classnames'
import useBoolean from 'ahooks/lib/useBoolean'
import { useTranslation } from 'react-i18next'
import ConfigPrompt from '../../config-prompt'
import { languageMap } from '../../../../workflow/nodes/_base/components/editor/code-editor/index'
import { generateRuleCode } from '@/service/debug'
import type { CodeGenRes } from '@/service/debug'
import type { ModelModeType } from '@/types/app'
import type { AppType, CompletionParams, Model } from '@/types/app'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import Button from '@/app/components/base/button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import type { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'

export type IGetCodeGeneratorResProps = {
  mode: AppType
  isShow: boolean
  codeLanguages: CodeLanguage
  onClose: () => void
  onFinished: (res: CodeGenRes) => void
}

export const GetCodeGeneratorResModal: FC<IGetCodeGeneratorResProps> = (
  {
    mode,
    isShow,
    codeLanguages,
    onClose,
    onFinished,
  },
) => {
  const { t } = useTranslation()
  const defaultCompletionParams = {
    temperature: 0.7,
    max_tokens: 0,
    top_p: 0,
    echo: false,
    stop: [],
    presence_penalty: 0,
    frequency_penalty: 0,
  }
  const localModel = localStorage.getItem('auto-gen-model')
    ? JSON.parse(localStorage.getItem('auto-gen-model') as string) as Model
    : null
  const [model, setModel] = React.useState<Model>(localModel || {
    name: '',
    provider: '',
    mode: mode as unknown as ModelModeType.chat,
    completion_params: defaultCompletionParams,
  })
  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const [instruction, setInstruction] = React.useState<string>('')
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [res, setRes] = React.useState<CodeGenRes | null>(null)
  const isValid = () => {
    if (instruction.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: t('appDebug.code.instruction'),
        }),
      })
      return false
    }
    return true
  }

  const handleModelChange = useCallback((newValue: { modelId: string; provider: string; mode?: string; features?: string[] }) => {
    const newModel = {
      ...model,
      provider: newValue.provider,
      name: newValue.modelId,
      mode: newValue.mode as ModelModeType,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model, setModel])

  const handleCompletionParamsChange = useCallback((newParams: FormValue) => {
    const newModel = {
      ...model,
      completion_params: newParams as CompletionParams,
    }
    setModel(newModel)
    localStorage.setItem('auto-gen-model', JSON.stringify(newModel))
  }, [model, setModel])

  const isInLLMNode = true
  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      const { error, ...res } = await generateRuleCode({
        instruction,
        model_config: model,
        no_variable: !!isInLLMNode,
        code_language: languageMap[codeLanguages] || 'javascript',
      })
      setRes(res)
      if (error) {
        Toast.notify({
          type: 'error',
          message: error,
        })
      }
    }
    finally {
      setLoadingFalse()
    }
  }
  const [showConfirmOverwrite, setShowConfirmOverwrite] = React.useState(false)

  useEffect(() => {
    if (defaultModel) {
      const localModel = localStorage.getItem('auto-gen-model')
        ? JSON.parse(localStorage.getItem('auto-gen-model') || '')
        : null
      if (localModel) {
        setModel({
          ...localModel,
          completion_params: {
            ...defaultCompletionParams,
            ...localModel.completion_params,
          },
        })
      }
      else {
        setModel(prev => ({
          ...prev,
          name: defaultModel.model,
          provider: defaultModel.provider.provider,
        }))
      }
    }
  }, [defaultModel])

  const renderLoading = (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3'>
      <Loading />
      <div className='text-[13px] text-text-tertiary'>{t('appDebug.codegen.loading')}</div>
    </div>
  )
  const renderNoData = (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8'>
      <Generator className='h-14 w-14 text-text-tertiary' />
      <div className='text-center text-[13px] font-normal leading-5 text-text-tertiary'>
        <div>{t('appDebug.codegen.noDataLine1')}</div>
        <div>{t('appDebug.codegen.noDataLine2')}</div>
      </div>
    </div>
  )

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='min-w-[1140px] !p-0'
      closable
    >
      <div className='relative flex h-[680px] flex-wrap'>
        <div className='h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-8'>
          <div className='mb-8'>
            <div className={'text-lg font-bold leading-[28px] text-text-primary'}>{t('appDebug.codegen.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-text-tertiary'>{t('appDebug.codegen.description')}</div>
          </div>
          <div className='mb-8'>
            <ModelParameterModal
              popupClassName='!w-[520px]'
              portalToFollowElemContentClassName='z-[1000]'
              isAdvancedMode={true}
              provider={model.provider}
              mode={model.mode}
              completionParams={model.completion_params}
              modelId={model.name}
              setModel={handleModelChange}
              onCompletionParamsChange={handleCompletionParamsChange}
              hideDebugWithMultipleModel
            />
          </div>
          <div>
            <div className='text-[0px]'>
              <div className='mb-2 text-sm font-medium leading-5 text-text-primary'>{t('appDebug.codegen.instruction')}</div>
              <Textarea
                className="h-[200px] resize-none"
                placeholder={t('appDebug.codegen.instructionPlaceholder') || ''}
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
                <Generator className='h-4 w-4 text-white' />
                <span className='text-xs font-semibold text-white'>{t('appDebug.codegen.generate')}</span>
              </Button>
            </div>
          </div>
        </div>
        {isLoading && renderLoading}
        {!isLoading && !res && renderNoData}
        {(!isLoading && res) && (
          <div className='h-full w-0 grow p-6 pb-0'>
            <div className='mb-3 shrink-0 text-base font-semibold leading-[160%] text-text-secondary'>{t('appDebug.codegen.resTitle')}</div>
            <div className={cn('max-h-[555px] overflow-y-auto', !isInLLMNode && 'pb-2')}>
              <ConfigPrompt
                mode={mode}
                promptTemplate={res?.code || ''}
                promptVariables={[]}
                readonly
                noTitle={isInLLMNode}
                gradientBorder
                editorHeight={isInLLMNode ? 524 : 0}
                noResize={isInLLMNode}
              />
              {!isInLLMNode && (
                <>
                  {res?.code && (
                    <div className='mt-4'>
                      <h3 className='mb-2 text-sm font-medium text-text-primary'>{t('appDebug.codegen.generatedCode')}</h3>
                      <pre className='overflow-x-auto rounded-lg bg-gray-50 p-4'>
                        <code className={`language-${res.language}`}>
                          {res.code}
                        </code>
                      </pre>
                    </div>
                  )}
                  {res?.error && (
                    <div className='mt-4 rounded-lg bg-red-50 p-4'>
                      <p className='text-sm text-red-600'>{res.error}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className='flex justify-end bg-background-default py-4'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' className='ml-2' onClick={() => {
                setShowConfirmOverwrite(true)
              }}>{t('appDebug.codegen.apply')}</Button>
            </div>
          </div>
        )}
      </div>
      {showConfirmOverwrite && (
        <Confirm
          title={t('appDebug.codegen.overwriteConfirmTitle')}
          content={t('appDebug.codegen.overwriteConfirmMessage')}
          isShow={showConfirmOverwrite}
          onConfirm={() => {
            setShowConfirmOverwrite(false)
            onFinished(res!)
          }}
          onCancel={() => setShowConfirmOverwrite(false)}
        />
      )}
    </Modal>
  )
}

export default React.memo(GetCodeGeneratorResModal)
