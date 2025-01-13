import type { FC } from 'react'
import React from 'react'
import cn from 'classnames'
import useBoolean from 'ahooks/lib/useBoolean'
import { useTranslation } from 'react-i18next'
import ConfigPrompt from '../../config-prompt'
import { languageMap } from '../../../../workflow/nodes/_base/components/editor/code-editor/index'
import { generateRuleCode } from '@/service/debug'
import type { CodeGenRes } from '@/service/debug'
import { type AppType, type Model, ModelModeType } from '@/types/app'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Toast from '@/app/components/base/toast'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import type { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
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
  const {
    currentProvider,
    currentModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const { t } = useTranslation()
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

  const renderLoading = (
    <div className='w-0 grow flex flex-col items-center justify-center h-full space-y-3'>
      <Loading />
      <div className='text-[13px] text-gray-400'>{t('appDebug.codegen.loading')}</div>
    </div>
  )
  const renderNoData = (
    <div className='w-0 grow flex flex-col items-center px-8 justify-center h-full space-y-3'>
      <Generator className='w-14 h-14 text-gray-300' />
      <div className='leading-5 text-center text-[13px] font-normal text-gray-400'>
        <div>{t('appDebug.codegen.noDataLine1')}</div>
        <div>{t('appDebug.codegen.noDataLine2')}</div>
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
            <div className={'leading-[28px] text-lg font-bold'}>{t('appDebug.codegen.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-gray-500'>{t('appDebug.codegen.description')}</div>
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
              <div className='mb-2 leading-5 text-sm font-medium text-gray-900'>{t('appDebug.codegen.instruction')}</div>
              <textarea
                className="w-full h-[200px] overflow-y-auto px-3 py-2 text-sm bg-gray-50 rounded-lg"
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
                <Generator className='w-4 h-4 text-white' />
                <span className='text-xs font-semibold text-white'>{t('appDebug.codegen.generate')}</span>
              </Button>
            </div>
          </div>
        </div>
        {isLoading && renderLoading}
        {!isLoading && !res && renderNoData}
        {(!isLoading && res) && (
          <div className='w-0 grow p-6 pb-0 h-full'>
            <div className='shrink-0 mb-3 leading-[160%] text-base font-semibold text-gray-800'>{t('appDebug.codegen.resTitle')}</div>
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
                      <h3 className='mb-2 text-sm font-medium text-gray-900'>{t('appDebug.codegen.generatedCode')}</h3>
                      <pre className='p-4 bg-gray-50 rounded-lg overflow-x-auto'>
                        <code className={`language-${res.language}`}>
                          {res.code}
                        </code>
                      </pre>
                    </div>
                  )}
                  {res?.error && (
                    <div className='mt-4 p-4 bg-red-50 rounded-lg'>
                      <p className='text-sm text-red-600'>{res.error}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className='flex justify-end py-4 bg-white'>
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
