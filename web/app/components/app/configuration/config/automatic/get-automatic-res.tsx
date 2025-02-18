'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
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
import ConfigPrompt from '@/app/components/app/configuration/config-prompt'
import type { Model } from '@/types/app'
import { AppType } from '@/types/app'
import ConfigVar from '@/app/components/app/configuration/config-var'
import GroupName from '@/app/components/app/configuration/base/group-name'
import Loading from '@/app/components/base/loading'
import Confirm from '@/app/components/base/confirm'
import { LoveMessage } from '@/app/components/base/icons/src/vender/features'

// type
import type { AutomaticRes } from '@/service/debug'
import { Generator } from '@/app/components/base/icons/src/vender/other'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'

export interface IGetAutomaticResProps {
  mode: AppType
  model: Model
  isShow: boolean
  onClose: () => void
  onFinished: (res: AutomaticRes) => void
  isInLLMNode?: boolean
}

const TryLabel: FC<{
  Icon: any
  text: string
  onClick: () => void
}> = ({ Icon, text, onClick }) => {
  return (
    <div
      className='mr-1 mt-2 flex h-7 shrink-0 cursor-pointer items-center rounded-lg bg-gray-100 px-2'
      onClick={onClick}
    >
      <Icon className='h-4 w-4 text-gray-500'></Icon>
      <div className='ml-1 text-xs font-medium text-gray-700'>{text}</div>
    </div>
  )
}

const GetAutomaticRes: FC<IGetAutomaticResProps> = ({
  mode,
  model,
  isShow,
  onClose,
  isInLLMNode,
  onFinished,
}) => {
  const { t } = useTranslation()
  const {
    currentProvider,
    currentModel,
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

  const [instruction, setInstruction] = React.useState<string>('')
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
  const [res, setRes] = React.useState<AutomaticRes | null>(null)

  const renderLoading = (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3'>
      <Loading />
      <div className='text-[13px] text-gray-400'>{t('appDebug.generate.loading')}</div>
    </div>
  )

  const renderNoData = (
    <div className='flex h-full w-0 grow flex-col items-center justify-center space-y-3 px-8'>
      <Generator className='h-14 w-14 text-gray-300' />
      <div className='text-center text-[13px] font-normal leading-5 text-gray-400'>
        <div>{t('appDebug.generate.noDataLine1')}</div>
        <div>{t('appDebug.generate.noDataLine2')}</div>
      </div>
    </div>
  )

  const onGenerate = async () => {
    if (!isValid())
      return
    if (isLoading)
      return
    setLoadingTrue()
    try {
      const { error, ...res } = await generateRule({
        instruction,
        model_config: model,
        no_variable: !!isInLLMNode,
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

  const isShowAutoPromptResPlaceholder = () => {
    return !isLoading && !res
  }

  return (
    <Modal
      isShow={isShow}
      onClose={onClose}
      className='min-w-[1140px] !p-0'
      closable
    >
      <div className='flex h-[680px] flex-wrap'>
        <div className='h-full w-[570px] shrink-0 overflow-y-auto border-r border-gray-100 p-6'>
          <div className='mb-8'>
            <div className={`text-lg font-bold leading-[28px] ${s.textGradient}`}>{t('appDebug.generate.title')}</div>
            <div className='mt-1 text-[13px] font-normal text-gray-500'>{t('appDebug.generate.description')}</div>
          </div>
          <div className='mb-8 flex items-center'>
            <ModelIcon
              className='mr-1.5 shrink-0 '
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
          <div >
            <div className='flex items-center'>
              <div className='mr-3 shrink-0 text-xs font-semibold uppercase leading-[18px] text-gray-500'>{t('appDebug.generate.tryIt')}</div>
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
          {/* inputs */}
          <div className='mt-6'>
            <div className='text-[0px]'>
              <div className='mb-2 text-sm font-medium leading-5 text-gray-900'>{t('appDebug.generate.instruction')}</div>
              <Textarea
                className="h-[200px] resize-none"
                placeholder={t('appDebug.generate.instructionPlaceHolder') as string}
                value={instruction}
                onChange={e => setInstruction(e.target.value)} />
            </div>

            <div className='mt-5 flex justify-end'>
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

        {(!isLoading && res) && (
          <div className='h-full w-0 grow p-6 pb-0'>
            <div className='mb-3 shrink-0 text-base font-semibold leading-[160%] text-gray-800'>{t('appDebug.generate.resTitle')}</div>
            <div className={cn('max-h-[555px] overflow-y-auto', !isInLLMNode && 'pb-2')}>
              <ConfigPrompt
                mode={mode}
                promptTemplate={res?.prompt || ''}
                promptVariables={[]}
                readonly
                noTitle={isInLLMNode}
                gradientBorder
                editorHeight={isInLLMNode ? 524 : 0}
                noResize={isInLLMNode}
              />
              {!isInLLMNode && (
                <>
                  {(res?.variables?.length && res?.variables?.length > 0)
                    ? (
                      <ConfigVar
                        promptVariables={res?.variables.map(key => ({ key, name: key, type: 'string', required: true })) || []}
                        readonly
                      />
                    )
                    : ''}

                  {(mode !== AppType.completion && res?.opening_statement) && (
                    <div className='mt-7'>
                      <GroupName name={t('appDebug.feature.groupChat.title')} />
                      <div
                        className='border-effects-highlight bg-background-section-burn mb-1 rounded-xl border-l-[0.5px] border-t-[0.5px] p-3'
                      >
                        <div className='mb-2 flex items-center gap-2'>
                          <div className='border-divider-subtle shadow-xs bg-util-colors-blue-light-blue-light-500 shrink-0 rounded-lg border-[0.5px] p-1'>
                            <LoveMessage className='text-text-primary-on-surface h-4 w-4' />
                          </div>
                          <div className='text-text-secondary system-sm-semibold flex grow items-center'>
                            {t('appDebug.feature.conversationOpener.title')}
                          </div>
                        </div>
                        <div className='text-text-tertiary system-xs-regular min-h-8'>{res.opening_statement}</div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className='flex justify-end bg-white py-4'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' className='ml-2' onClick={() => {
                setShowConfirmOverwrite(true)
              }}>{t('appDebug.generate.apply')}</Button>
            </div>
          </div>
        )}
        {isLoading && renderLoading}
        {isShowAutoPromptResPlaceholder() && renderNoData}
        {showConfirmOverwrite && (
          <Confirm
            title={t('appDebug.generate.overwriteTitle')}
            content={t('appDebug.generate.overwriteMessage')}
            isShow={showConfirmOverwrite}
            onConfirm={() => {
              setShowConfirmOverwrite(false)
              onFinished(res!)
            }}
            onCancel={() => setShowConfirmOverwrite(false)}
          />
        )}
      </div>
    </Modal>
  )
}
export default React.memo(GetAutomaticRes)
