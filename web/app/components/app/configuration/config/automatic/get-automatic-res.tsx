'use client'
import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
// type
import type { GenRes } from '@/service/debug'
import type { AppModeEnum, CompletionParams, Model, ModelModeType } from '@/types/app'
import {
  RiDatabase2Line,
  RiFileExcel2Line,
  RiGitCommitLine,
  RiNewspaperLine,
  RiPresentationLine,
  RiRoadMapLine,
  RiTerminalBoxLine,
  RiTranslate,
  RiUser2Line,
} from '@remixicon/react'
import { useBoolean, useSessionStorageState } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import Loading from '@/app/components/base/loading'

import Modal from '@/app/components/base/modal'
import Toast from '@/app/components/base/toast'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'

import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { generateBasicAppFirstTimeRule, generateRule } from '@/service/debug'
import { useGenerateRuleTemplate } from '@/service/use-apps'
import IdeaOutput from './idea-output'
import InstructionEditorInBasic from './instruction-editor'
import InstructionEditorInWorkflow from './instruction-editor-in-workflow'
import ResPlaceholder from './res-placeholder'
import Result from './result'
import s from './style.module.css'
import { GeneratorType } from './types'
import useGenData from './use-gen-data'

const i18nPrefix = 'generate'

export type IGetAutomaticResProps = {
  mode: AppModeEnum
  isShow: boolean
  onClose: () => void
  onFinished: (res: GenRes) => void
  flowId?: string
  nodeId?: string
  editorId?: string
  currentPrompt?: string
  isBasicMode?: boolean
}

const TryLabel: FC<{
  Icon: any
  text: string
  onClick: () => void
}> = ({ Icon, text, onClick }) => {
  return (
    <div
      className="mr-1 mt-2 flex h-7 shrink-0 cursor-pointer items-center rounded-lg bg-components-button-secondary-bg px-2"
      onClick={onClick}
    >
      <Icon className="h-4 w-4 text-text-tertiary"></Icon>
      <div className="ml-1 text-xs font-medium text-text-secondary">{text}</div>
    </div>
  )
}

const GetAutomaticRes: FC<IGetAutomaticResProps> = ({
  mode,
  isShow,
  onClose,
  flowId,
  nodeId,
  editorId,
  currentPrompt,
  isBasicMode,
  onFinished,
}) => {
  const { t } = useTranslation()
  const localModel = localStorage.getItem('auto-gen-model')
    ? JSON.parse(localStorage.getItem('auto-gen-model') as string) as Model
    : null
  const [model, setModel] = React.useState<Model>(localModel || {
    name: '',
    provider: '',
    mode: mode as unknown as ModelModeType.chat,
    completion_params: {} as CompletionParams,
  })
  const {
    defaultModel,
  } = useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.textGeneration)
  const tryList = [
    {
      icon: RiTerminalBoxLine,
      key: 'pythonDebugger',
    },
    {
      icon: RiTranslate,
      key: 'translation',
    },
    {
      icon: RiPresentationLine,
      key: 'meetingTakeaways',
    },
    {
      icon: RiNewspaperLine,
      key: 'writingsPolisher',
    },
    {
      icon: RiUser2Line,
      key: 'professionalAnalyst',
    },
    {
      icon: RiFileExcel2Line,
      key: 'excelFormulaExpert',
    },
    {
      icon: RiRoadMapLine,
      key: 'travelPlanning',
    },
    {
      icon: RiDatabase2Line,
      key: 'SQLSorcerer',
    },
    {
      icon: RiGitCommitLine,
      key: 'GitGud',
    },
  ] as const

  const [instructionFromSessionStorage, setInstruction] = useSessionStorageState<string>(`improve-instruction-${flowId}${isBasicMode ? '' : `-${nodeId}${editorId ? `-${editorId}` : ''}`}`)
  const instruction = instructionFromSessionStorage || ''
  const [ideaOutput, setIdeaOutput] = useState<string>('')

  type TemplateKey = typeof tryList[number]['key']

  const [editorKey, setEditorKey] = useState(`${flowId}-0`)
  const handleChooseTemplate = useCallback((key: TemplateKey) => {
    return () => {
      const template = t(`generate.template.${key}.instruction` as const, { ns: 'appDebug' })
      setInstruction(template)
      setEditorKey(`${flowId}-${Date.now()}`)
    }
  }, [t])

  const { data: instructionTemplate } = useGenerateRuleTemplate(GeneratorType.prompt, isBasicMode)
  useEffect(() => {
    if (!instruction && instructionTemplate)
      setInstruction(instructionTemplate.data)

    setEditorKey(`${flowId}-${Date.now()}`)
  }, [instructionTemplate])

  const isValid = () => {
    if (instruction.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('errorMsg.fieldRequired', {
          ns: 'common',
          field: t('generate.instruction', { ns: 'appDebug' }),
        }),
      })
      return false
    }
    return true
  }
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const storageKey = `${flowId}${isBasicMode ? '' : `-${nodeId}${editorId ? `-${editorId}` : ''}`}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenData({
    storageKey,
  })

  useEffect(() => {
    if (defaultModel) {
      const localModel = localStorage.getItem('auto-gen-model')
        ? JSON.parse(localStorage.getItem('auto-gen-model') || '')
        : null
      if (localModel) {
        setModel(localModel)
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
    <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">{t('generate.loading', { ns: 'appDebug' })}</div>
    </div>
  )

  const handleModelChange = useCallback((newValue: { modelId: string, provider: string, mode?: string, features?: string[] }) => {
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
      let apiRes: GenRes
      let hasError = false
      if (isBasicMode || !currentPrompt) {
        const { error, ...res } = await generateBasicAppFirstTimeRule({
          instruction,
          model_config: model,
          no_variable: false,
        })
        apiRes = {
          ...res,
          modified: res.prompt,
        } as GenRes
        if (error) {
          hasError = true
          Toast.notify({
            type: 'error',
            message: error,
          })
        }
      }
      else {
        const { error, ...res } = await generateRule({
          flow_id: flowId,
          node_id: nodeId,
          current: currentPrompt,
          instruction,
          ideal_output: ideaOutput,
          model_config: model,
        })
        apiRes = res
        if (error) {
          hasError = true
          Toast.notify({
            type: 'error',
            message: error,
          })
        }
      }
      if (!hasError)
        addVersion(apiRes)
    }
    finally {
      setLoadingFalse()
    }
  }

  const [isShowConfirmOverwrite, {
    setTrue: showConfirmOverwrite,
    setFalse: hideShowConfirmOverwrite,
  }] = useBoolean(false)

  const isShowAutoPromptResPlaceholder = () => {
    return !isLoading && !current
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className="min-w-[1140px] !p-0"
    >
      <div className="flex h-[680px] flex-wrap">
        <div className="h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6">
          <div className="mb-5">
            <div className={`text-lg font-bold leading-[28px] ${s.textGradient}`}>{t('generate.title', { ns: 'appDebug' })}</div>
            <div className="mt-1 text-[13px] font-normal text-text-tertiary">{t('generate.description', { ns: 'appDebug' })}</div>
          </div>
          <div>
            <ModelParameterModal
              popupClassName="!w-[520px]"
              portalToFollowElemContentClassName="z-[1000]"
              isAdvancedMode={true}
              provider={model.provider}
              completionParams={model.completion_params}
              modelId={model.name}
              setModel={handleModelChange}
              onCompletionParamsChange={handleCompletionParamsChange}
              hideDebugWithMultipleModel
            />
          </div>
          {isBasicMode && (
            <div className="mt-4">
              <div className="flex items-center">
                <div className="mr-3 shrink-0 text-xs font-semibold uppercase leading-[18px] text-text-tertiary">{t('generate.tryIt', { ns: 'appDebug' })}</div>
                <div
                  className="h-px grow"
                  style={{
                    background: 'linear-gradient(to right, rgba(243, 244, 246, 1), rgba(243, 244, 246, 0))',
                  }}
                >
                </div>
              </div>
              <div className="flex flex-wrap">
                {tryList.map(item => (
                  <TryLabel
                    key={item.key}
                    Icon={item.icon}
                    text={t(`generate.template.${item.key}.name`, { ns: 'appDebug' })}
                    onClick={handleChooseTemplate(item.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* inputs */}
          <div className="mt-4">
            <div>
              <div className="system-sm-semibold-uppercase mb-1.5 text-text-secondary">{t('generate.instruction', { ns: 'appDebug' })}</div>
              {isBasicMode
                ? (
                    <InstructionEditorInBasic
                      editorKey={editorKey}
                      generatorType={GeneratorType.prompt}
                      value={instruction}
                      onChange={setInstruction}
                      availableVars={[]}
                      availableNodes={[]}
                      isShowCurrentBlock={!!currentPrompt}
                      isShowLastRunBlock={false}
                    />
                  )
                : (
                    <InstructionEditorInWorkflow
                      editorKey={editorKey}
                      generatorType={GeneratorType.prompt}
                      value={instruction}
                      onChange={setInstruction}
                      nodeId={nodeId || ''}
                      isShowCurrentBlock={!!currentPrompt}
                    />
                  )}
            </div>
            <IdeaOutput
              value={ideaOutput}
              onChange={setIdeaOutput}
            />

            <div className="mt-7 flex justify-end space-x-2">
              <Button onClick={onClose}>{t(`${i18nPrefix}.dismiss`, { ns: 'appDebug' })}</Button>
              <Button
                className="flex space-x-1"
                variant="primary"
                onClick={onGenerate}
                disabled={isLoading}
              >
                <Generator className="h-4 w-4" />
                <span className="text-xs font-semibold">{t('generate.generate', { ns: 'appDebug' })}</span>
              </Button>
            </div>
          </div>
        </div>

        {(!isLoading && current) && (
          <div className="h-full w-0 grow bg-background-default-subtle p-6 pb-0">
            <Result
              current={current!}
              isBasicMode={isBasicMode}
              nodeId={nodeId!}
              currentVersionIndex={currentVersionIndex || 0}
              setCurrentVersionIndex={setCurrentVersionIndex}
              versions={versions || []}
              onApply={showConfirmOverwrite}
              generatorType={GeneratorType.prompt}
            />
          </div>
        )}
        {isLoading && renderLoading}
        {isShowAutoPromptResPlaceholder() && <ResPlaceholder />}
        {isShowConfirmOverwrite && (
          <Confirm
            title={t('generate.overwriteTitle', { ns: 'appDebug' })}
            content={t('generate.overwriteMessage', { ns: 'appDebug' })}
            isShow
            onConfirm={() => {
              hideShowConfirmOverwrite()
              onFinished(current!)
            }}
            onCancel={hideShowConfirmOverwrite}
          />
        )}
      </div>
    </Modal>
  )
}
export default React.memo(GetAutomaticRes)
