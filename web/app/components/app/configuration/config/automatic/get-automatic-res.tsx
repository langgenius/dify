'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
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
import cn from 'classnames'
import s from './style.module.css'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Textarea from '@/app/components/base/textarea'
import Toast from '@/app/components/base/toast'
import { generateRule } from '@/service/debug'
import type { CompletionParams, Model } from '@/types/app'
import type { AppType } from '@/types/app'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'

// type
import type { AutomaticRes } from '@/service/debug'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'

import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import type { ModelModeType } from '@/types/app'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import InstructionEditor from './instruction-editor'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import type { GeneratorType } from './types'
import { ArrowDownRoundFill } from '@/app/components/base/icons/src/vender/solid/general'
import Link from 'next/link'
import Result from './result'

const i18nPrefix = 'appDebug.generate'
export type IGetAutomaticResProps = {
  mode: AppType
  isShow: boolean
  onClose: () => void
  onFinished: (res: AutomaticRes) => void
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  generatorType: GeneratorType
  flowId: string
  nodeId?: string
  isBasicMode?: boolean
}

const TryLabel: FC<{
  Icon: any
  text: string
  onClick: () => void
}> = ({ Icon, text, onClick }) => {
  return (
    <div
      className='mr-1 mt-2 flex h-7 shrink-0 cursor-pointer items-center rounded-lg bg-components-button-secondary-bg px-2'
      onClick={onClick}
    >
      <Icon className='h-4 w-4 text-text-tertiary'></Icon>
      <div className='ml-1 text-xs font-medium text-text-secondary'>{text}</div>
    </div>
  )
}

const GetAutomaticRes: FC<IGetAutomaticResProps> = ({
  mode,
  isShow,
  onClose,
  nodesOutputVars,
  availableNodes,
  generatorType,
  flowId,
  nodeId,
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
  ]

  const [instruction, setInstruction] = useState<string>('The travel plan to Anshun of Guizhou Province in China') // TODO: test value
  const [ideaOutput, setIdeaOutput] = useState<string>('use json format to output the result. Content in result uses Chinese. Format: {"summary: "summary content", "result": "result content"}')
  const [currentPrompt, setCurrentPrompt] = useState<string>('')
  const [isFoldIdeaOutput, {
    toggle: toggleFoldIdeaOutput,
  }] = useBoolean(true)

  const handleChooseTemplate = useCallback((key: string) => {
    return () => {
      const template = t(`appDebug.generate.template.${key}.instruction`)
      setInstruction(template)
    }
  }, [t])
  const isValid = () => {
    if (instruction.trim() === '') {
      Toast.notify({
        type: 'error',
        message: t('common.errorMsg.fieldRequired', {
          field: t('appDebug.generate.instruction'),
        }),
      })
      return false
    }
    return true
  }
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const [res, setRes] = useState<AutomaticRes | null>(null)

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
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3'>
      <Loading />
      <div className='text-[13px] text-text-tertiary'>{t('appDebug.generate.loading')}</div>
    </div>
  )

  const renderNoData = (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8'>
      <Generator className='size-8 text-text-quaternary' />
      <div className='text-center text-[13px] font-normal leading-5 text-text-tertiary'>
        <div>{t('appDebug.generate.newNoDataLine1')}</div>
        <Link className='text-text-accent' href='//todo' target='_blank'>{t('appDebug.generate.newNoDataLine2')}</Link>
      </div>
    </div>
  )

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
        current: currentPrompt,
        instruction,
        idea_output: ideaOutput,
        model_config: model,
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

  const [isShowConfirmOverwrite, {
    setTrue: showConfirmOverwrite,
    setFalse: hideShowConfirmOverwrite,
  }] = useBoolean(false)

  const isShowAutoPromptResPlaceholder = () => {
    return !isLoading && !res
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='min-w-[1140px] !p-0'
    >
      <div className='flex h-[680px] flex-wrap'>
        <div className='h-full w-[570px] shrink-0 overflow-y-auto border-r border-divider-regular p-6'>
          <div className='mb-4'>
            <div className={`text-lg font-bold leading-[28px] ${s.textGradient}`}>{t('appDebug.generate.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-text-tertiary'>{t('appDebug.generate.description')}</div>
          </div>
          <div>
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
          {isBasicMode && (
            <div className='mt-4'>
              <div className='flex items-center'>
                <div className='mr-3 shrink-0 text-xs font-semibold uppercase leading-[18px] text-text-tertiary'>{t('appDebug.generate.tryIt')}</div>
                <div className='h-px grow' style={{
                  background: 'linear-gradient(to right, rgba(243, 244, 246, 1), rgba(243, 244, 246, 0))',
                }}></div>
              </div>
              <div className='flex flex-wrap'>
                {tryList.map(item => (
                  <TryLabel
                    key={item.key}
                    Icon={item.icon}
                    text={t(`appDebug.generate.template.${item.key}.name`)}
                    onClick={handleChooseTemplate(item.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* inputs */}
          <div className='mt-4'>
            <div>
              <div className='system-sm-semibold-uppercase mb-1.5 text-text-secondary'>{t('appDebug.generate.instruction')}</div>
              <InstructionEditor
                value={instruction}
                onChange={setInstruction}
                nodesOutputVars={nodesOutputVars}
                availableNodes={availableNodes}
                generatorType={generatorType}
              />
            </div>
            <div className='mt-4 text-[0px]'>
              <div
                className='mb-1.5 flex  cursor-pointer items-center text-sm font-medium leading-5 text-text-primary'
                onClick={toggleFoldIdeaOutput}
              >
                <div className='system-sm-semibold-uppercase mr-1 text-text-secondary'>{t(`${i18nPrefix}.ideaOutput`)}</div>
                <div className='system-xs-regular text-text-tertiary'>({t(`${i18nPrefix}.optional`)})</div>
                <ArrowDownRoundFill className={cn('size text-text-quaternary', isFoldIdeaOutput && 'relative top-[1px] rotate-[-90deg]')} />
              </div>
              { !isFoldIdeaOutput && (
                <Textarea
                  className="h-[80px]"
                  placeholder={t(`${i18nPrefix}.ideaOutputPlaceholder`)}
                  value={ideaOutput}
                  onChange={e => setIdeaOutput(e.target.value)}
                />
              )}
            </div>

            <div className='mt-7 flex justify-end space-x-2'>
              <Button onClick={onClose}>{t(`${i18nPrefix}.dismiss`)}</Button>
              <Button
                className='flex space-x-1'
                variant='primary'
                onClick={onGenerate}
                disabled={isLoading}
              >
                <Generator className='h-4 w-4 text-white' />
                <span className='text-xs font-semibold text-white'>{t('appDebug.generate.generate')}</span>
              </Button>
            </div>
          </div>
        </div>

        {/* {(!isLoading && res) && ( */}
        {
          <div className='h-full w-0 grow p-6 pb-0'>
            <Result
              storageKey={`${flowId}${isBasicMode ? '' : `-${nodeId}`}`}
              onApply={showConfirmOverwrite}
              generatorType={generatorType}
            />
          </div>
        }
        {isLoading && renderLoading}
        {isShowAutoPromptResPlaceholder() && !renderNoData}
        {isShowConfirmOverwrite && (
          <Confirm
            title={t('appDebug.generate.overwriteTitle')}
            content={t('appDebug.generate.overwriteMessage')}
            isShow
            onConfirm={() => {
              hideShowConfirmOverwrite()
              onFinished(res!)
            }}
            onCancel={hideShowConfirmOverwrite}
          />
        )}
      </div>
    </Modal>
  )
}
export default React.memo(GetAutomaticRes)
