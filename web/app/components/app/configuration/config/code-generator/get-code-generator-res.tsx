import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import useBoolean from 'ahooks/lib/useBoolean'
import { useTranslation } from 'react-i18next'
import { languageMap } from '../../../../workflow/nodes/_base/components/editor/code-editor/index'
import { generateRule } from '@/service/debug'
import type { GenRes } from '@/service/debug'
import type { ModelModeType } from '@/types/app'
import type { AppType, CompletionParams, Model } from '@/types/app'
import Modal from '@/app/components/base/modal'
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
import IdeaOutput from '../automatic/idea-output'
import { GeneratorType } from '../automatic/types'
import InstructionEditor from '../automatic/instruction-editor-in-workflow'
import useGenData from '../automatic/use-gen-data'
import Result from '../automatic/result'
import ResPlaceholder from '../automatic/res-placeholder'
import { useGenerateRuleTemplate } from '@/service/use-apps'
import { useSessionStorageState } from 'ahooks'
import s from '../automatic/style.module.css'

const i18nPrefix = 'appDebug.generate'
export type IGetCodeGeneratorResProps = {
  flowId: string
  nodeId: string
  currentCode?: string
  mode: AppType
  isShow: boolean
  codeLanguages: CodeLanguage
  onClose: () => void
  onFinished: (res: GenRes) => void
}

export const GetCodeGeneratorResModal: FC<IGetCodeGeneratorResProps> = (
  {
    flowId,
    nodeId,
    currentCode,
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
  const [instructionFromSessionStorage, setInstruction] = useSessionStorageState<string>(`improve-instruction-${flowId}-${nodeId}`)
  const instruction = instructionFromSessionStorage || ''

  const [ideaOutput, setIdeaOutput] = useState<string>('')

  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const storageKey = `${flowId}-${nodeId}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenData({
    storageKey,
  })
  const [editorKey, setEditorKey] = useState(`${flowId}-0`)
  const { data: instructionTemplate } = useGenerateRuleTemplate(GeneratorType.code)
  useEffect(() => {
    if (!instruction && instructionTemplate)
      setInstruction(instructionTemplate.data)

    setEditorKey(`${flowId}-${Date.now()}`)
  }, [instructionTemplate])

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

  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      const { error, ...res } = await generateRule({
        flow_id: flowId,
        node_id: nodeId,
        current: currentCode,
        instruction,
        model_config: model,
        ideal_output: ideaOutput,
        language: languageMap[codeLanguages] || 'javascript',
      })
      if((res as any).code) // not current or current is the same as the template would return a code field
        res.modified = (res as any).code

      if (error) {
        Toast.notify({
          type: 'error',
          message: error,
        })
      }
      else {
        addVersion(res)
      }
    }
    finally {
      setLoadingFalse()
    }
  }

  const [isShowConfirmOverwrite, {
    setTrue: showConfirmOverwrite,
    setFalse: hideShowConfirmOverwrite,
  }] = useBoolean(false)

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

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='min-w-[1140px] !p-0'
    >
      <div className='relative flex h-[680px] flex-wrap'>
        <div className='h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6'>
          <div className='mb-5'>
            <div className={`text-lg font-bold leading-[28px] ${s.textGradient}`}>{t('appDebug.codegen.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-text-tertiary'>{t('appDebug.codegen.description')}</div>
          </div>
          <div className='mb-4'>
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
              <div className='system-sm-semibold-uppercase mb-1.5 text-text-secondary'>{t('appDebug.codegen.instruction')}</div>
              <InstructionEditor
                editorKey={editorKey}
                value={instruction}
                onChange={setInstruction}
                nodeId={nodeId}
                generatorType={GeneratorType.code}
                isShowCurrentBlock={!!currentCode}
              />
            </div>
            <IdeaOutput
              value={ideaOutput}
              onChange={setIdeaOutput}
            />

            <div className='mt-7 flex justify-end space-x-2'>
              <Button onClick={onClose}>{t(`${i18nPrefix}.dismiss`)}</Button>
              <Button
                className='flex space-x-1'
                variant='primary'
                onClick={onGenerate}
                disabled={isLoading}
              >
                <Generator className='h-4 w-4' />
                <span className='text-xs font-semibold '>{t('appDebug.codegen.generate')}</span>
              </Button>
            </div>
          </div>
        </div>
        {isLoading && renderLoading}
        {!isLoading && !current && <ResPlaceholder />}
        {(!isLoading && current) && (
          <div className='h-full w-0 grow bg-background-default-subtle p-6 pb-0'>
            <Result
              current={current!}
              currentVersionIndex={currentVersionIndex || 0}
              setCurrentVersionIndex={setCurrentVersionIndex}
              versions={versions || []}
              onApply={showConfirmOverwrite}
              generatorType={GeneratorType.code}
            />
          </div>
        )}
      </div>
      {isShowConfirmOverwrite && (
        <Confirm
          title={t('appDebug.codegen.overwriteConfirmTitle')}
          content={t('appDebug.codegen.overwriteConfirmMessage')}
          isShow
          onConfirm={() => {
            hideShowConfirmOverwrite()
            onFinished(current!)
          }}
          onCancel={hideShowConfirmOverwrite}
        />
      )}
    </Modal>
  )
}

export default React.memo(GetCodeGeneratorResModal)
