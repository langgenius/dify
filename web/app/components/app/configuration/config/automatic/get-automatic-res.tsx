'use client'
import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
// type
import type { GenRes } from '@/service/debug'
import type { AppModeEnum, CompletionParams, Model, ModelModeType } from '@/types/app'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { useBoolean, useSessionStorageState } from 'ahooks'
import * as React from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/components/app/configuration/toast'
import Loading from '@/app/components/base/loading'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { consoleQuery } from '@/service/client'
import { generateBasicAppFirstTimeRule, generateRule } from '@/service/debug'
import { useAutoGenModel } from '../auto-gen-model-storage'
import IdeaOutput from './idea-output'
import InstructionEditorInBasic from './instruction-editor'
import InstructionEditorInWorkflow from './instruction-editor-in-workflow'
import ResPlaceholder from './res-placeholder'
import Result from './result'
import s from './style.module.css'
import { GeneratorType } from './types'
import useGenData from './use-gen-data'

const i18nPrefix = 'generate'

type IGetAutomaticResProps = {
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
  iconClassName: string
  text: string
  onClick: () => void
}> = ({ iconClassName, text, onClick }) => {
  return (
    <button
      type="button"
      className="mt-2 mr-1 flex h-7 shrink-0 cursor-pointer items-center rounded-lg bg-components-button-secondary-bg px-2"
      onClick={onClick}
    >
      <span aria-hidden className={`${iconClassName} size-4 text-text-tertiary`} />
      <div className="ml-1 text-xs font-medium text-text-secondary">{text}</div>
    </button>
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
  const [storedModel, setStoredModel] = useAutoGenModel()
  const [selectedModel, setSelectedModel] = React.useState<Model>()
  const { defaultModel } = useModelListAndDefaultModelAndCurrentProviderAndModel(
    ModelTypeEnum.textGeneration,
  )
  const model = useMemo<Model>(() => {
    if (selectedModel) return selectedModel
    if (storedModel) return storedModel

    return {
      name: defaultModel?.model ?? '',
      provider: defaultModel?.provider.provider ?? '',
      mode: mode as unknown as ModelModeType,
      completion_params: {} as CompletionParams,
    }
  }, [defaultModel, mode, selectedModel, storedModel])
  const tryList = [
    {
      iconClassName: 'i-ri-terminal-box-line',
      key: 'pythonDebugger',
    },
    {
      iconClassName: 'i-ri-translate',
      key: 'translation',
    },
    {
      iconClassName: 'i-ri-presentation-line',
      key: 'meetingTakeaways',
    },
    {
      iconClassName: 'i-ri-newspaper-line',
      key: 'writingsPolisher',
    },
    {
      iconClassName: 'i-ri-user-2-line',
      key: 'professionalAnalyst',
    },
    {
      iconClassName: 'i-ri-file-excel-2-line',
      key: 'excelFormulaExpert',
    },
    {
      iconClassName: 'i-ri-road-map-line',
      key: 'travelPlanning',
    },
    {
      iconClassName: 'i-ri-database-2-line',
      key: 'SQLSorcerer',
    },
    {
      iconClassName: 'i-ri-git-commit-line',
      key: 'GitGud',
    },
  ] as const

  const [instructionFromSessionStorage, setInstructionFromSessionStorage] =
    useSessionStorageState<string>(
      `improve-instruction-${flowId}${isBasicMode ? '' : `-${nodeId}${editorId ? `-${editorId}` : ''}`}`,
    )
  const [ideaOutput, setIdeaOutput] = useState<string>('')

  type TemplateKey = (typeof tryList)[number]['key']

  const [editorKey, setEditorKey] = useState(`${flowId}-0`)
  const handleChooseTemplate = useCallback(
    (key: TemplateKey) => {
      return () => {
        const template = t(($) => $[`generate.template.${key}.instruction` as const], {
          ns: 'appDebug',
        })
        setInstructionFromSessionStorage(template)
        setEditorKey(`${flowId}-${Date.now()}`)
      }
    },
    [flowId, setInstructionFromSessionStorage, t],
  )

  const { data: instructionTemplate } = useQuery({
    ...consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: GeneratorType.prompt } },
    }),
    enabled: !isBasicMode,
    retry: 0,
  })
  const instruction = instructionFromSessionStorage ?? instructionTemplate?.data ?? ''
  const instructionEditorKey = `${editorKey}-${instructionTemplate ? 'template' : 'pending'}`

  const isValid = () => {
    if (instruction.trim() === '') {
      toast.error(
        t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $['generate.instruction'], { ns: 'appDebug' }),
        }),
      )
      return false
    }
    return true
  }
  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const storageKey = `${flowId}${isBasicMode ? '' : `-${nodeId}${editorId ? `-${editorId}` : ''}`}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenData(
    {
      storageKey,
    },
  )

  const renderLoading = (
    <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">
        {t(($) => $['generate.loading'], { ns: 'appDebug' })}
      </div>
    </div>
  )

  const handleModelChange = useCallback(
    (newValue: { modelId: string; provider: string; mode?: string; features?: string[] }) => {
      const newModel = {
        ...model,
        provider: newValue.provider,
        name: newValue.modelId,
        mode: newValue.mode as ModelModeType,
      }
      setSelectedModel(newModel)
      setStoredModel(newModel)
    },
    [model, setStoredModel],
  )

  const handleCompletionParamsChange = useCallback(
    (newParams: FormValue) => {
      const newModel = {
        ...model,
        completion_params: newParams as CompletionParams,
      }
      setSelectedModel(newModel)
      setStoredModel(newModel)
    },
    [model, setStoredModel],
  )

  const onGenerate = async () => {
    if (!isValid()) return
    if (isLoading) return
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
          toast.error(error)
        }
      } else {
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
          toast.error(error)
        }
      }
      if (!hasError) addVersion(apiRes)
    } finally {
      setLoadingFalse()
    }
  }

  const [
    isShowConfirmOverwrite,
    { setTrue: showConfirmOverwrite, setFalse: hideShowConfirmOverwrite },
  ] = useBoolean(false)

  const isShowAutoPromptResPlaceholder = () => {
    return !isLoading && !current
  }

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="h-[min(680px,calc(100dvh-2rem))] max-h-none! w-285 max-w-none! min-w-285 overflow-hidden! border-none p-0! text-left align-middle">
        <div className="flex h-full min-h-0 flex-wrap">
          <div className="h-full w-142.5 shrink-0 overflow-y-auto border-r border-divider-regular p-6">
            <div className="mb-5">
              <div className={`text-lg leading-7 font-bold ${s.textGradient}`}>
                {t(($) => $['generate.title'], { ns: 'appDebug' })}
              </div>
              <div className="mt-1 text-[13px] font-normal text-text-tertiary">
                {t(($) => $['generate.description'], { ns: 'appDebug' })}
              </div>
            </div>
            <div>
              <ModelParameterModal
                popupClassName="w-[520px]!"
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
                  <div className="mr-3 shrink-0 text-xs leading-4.5 font-semibold text-text-tertiary uppercase">
                    {t(($) => $['generate.tryIt'], { ns: 'appDebug' })}
                  </div>
                  <div
                    className="h-px grow"
                    style={{
                      background:
                        'linear-gradient(to right, rgba(243, 244, 246, 1), rgba(243, 244, 246, 0))',
                    }}
                  ></div>
                </div>
                <div className="flex flex-wrap">
                  {tryList.map((item) => (
                    <TryLabel
                      key={item.key}
                      iconClassName={item.iconClassName}
                      text={t(($) => $[`generate.template.${item.key}.name`], { ns: 'appDebug' })}
                      onClick={handleChooseTemplate(item.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* inputs */}
            <div className="mt-4">
              <div>
                <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
                  {t(($) => $['generate.instruction'], { ns: 'appDebug' })}
                </div>
                {isBasicMode ? (
                  <InstructionEditorInBasic
                    editorKey={instructionEditorKey}
                    generatorType={GeneratorType.prompt}
                    value={instruction}
                    onChange={setInstructionFromSessionStorage}
                    availableVars={[]}
                    availableNodes={[]}
                    isShowCurrentBlock={!!currentPrompt}
                    isShowLastRunBlock={false}
                  />
                ) : (
                  <InstructionEditorInWorkflow
                    editorKey={instructionEditorKey}
                    generatorType={GeneratorType.prompt}
                    value={instruction}
                    onChange={setInstructionFromSessionStorage}
                    nodeId={nodeId || ''}
                    isShowCurrentBlock={!!currentPrompt}
                  />
                )}
              </div>
              <IdeaOutput value={ideaOutput} onChange={setIdeaOutput} />

              <div className="mt-7 flex justify-end space-x-2">
                <Button onClick={onClose}>
                  {t(($) => $[`${i18nPrefix}.dismiss`], { ns: 'appDebug' })}
                </Button>
                <Button
                  className="flex"
                  variant="primary"
                  onClick={onGenerate}
                  disabled={isLoading}
                >
                  <span aria-hidden className="i-custom-vender-other-generator size-4" />
                  <span className="text-xs font-semibold">
                    {t(($) => $['generate.generate'], { ns: 'appDebug' })}
                  </span>
                </Button>
              </div>
            </div>
          </div>

          {!isLoading && current && (
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
          <AlertDialog
            open={isShowConfirmOverwrite}
            onOpenChange={(open) => !open && hideShowConfirmOverwrite()}
          >
            <AlertDialogContent>
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t(($) => $['generate.overwriteTitle'], { ns: 'appDebug' })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $['generate.overwriteMessage'], { ns: 'appDebug' })}
                </AlertDialogDescription>
              </div>
              <AlertDialogActions>
                <AlertDialogCancelButton>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton
                  onClick={() => {
                    hideShowConfirmOverwrite()
                    onFinished(current!)
                  }}
                >
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogActions>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default React.memo(GetAutomaticRes)
