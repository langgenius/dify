import type { FC } from 'react'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
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
import { generateRule } from '@/service/debug'
import { languageMap } from '../../../../workflow/nodes/_base/components/editor/code-editor/index'
import { useAutoGenModel } from '../auto-gen-model-storage'
import IdeaOutput from '../automatic/idea-output'
import InstructionEditor from '../automatic/instruction-editor-in-workflow'
import ResPlaceholder from '../automatic/res-placeholder'
import Result from '../automatic/result'
import s from '../automatic/style.module.css'
import { GeneratorType } from '../automatic/types'
import useGenData from '../automatic/use-gen-data'

const i18nPrefix = 'generate'
const defaultCompletionParams = {
  temperature: 0.7,
  max_tokens: 0,
  top_p: 0,
  echo: false,
  stop: [],
  presence_penalty: 0,
  frequency_penalty: 0,
}

type IGetCodeGeneratorResProps = {
  flowId: string
  nodeId: string
  currentCode?: string
  mode: AppModeEnum
  isShow: boolean
  codeLanguages: CodeLanguage
  onClose: () => void
  onFinished: (res: GenRes) => void
}

export const GetCodeGeneratorResModal: FC<IGetCodeGeneratorResProps> = ({
  flowId,
  nodeId,
  currentCode,
  mode,
  isShow,
  codeLanguages,
  onClose,
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
    if (storedModel) {
      return {
        ...storedModel,
        completion_params: {
          ...defaultCompletionParams,
          ...storedModel.completion_params,
        },
      }
    }

    return {
      name: defaultModel?.model ?? '',
      provider: defaultModel?.provider.provider ?? '',
      mode: mode as unknown as ModelModeType,
      completion_params: defaultCompletionParams,
    }
  }, [defaultModel, mode, selectedModel, storedModel])
  const [instructionFromSessionStorage, setInstructionFromSessionStorage] =
    useSessionStorageState<string>(`improve-instruction-${flowId}-${nodeId}`)

  const [ideaOutput, setIdeaOutput] = useState<string>('')

  const [isLoading, { setTrue: setLoadingTrue, setFalse: setLoadingFalse }] = useBoolean(false)
  const storageKey = `${flowId}-${nodeId}`
  const { addVersion, current, currentVersionIndex, setCurrentVersionIndex, versions } = useGenData(
    {
      storageKey,
    },
  )
  const [editorKey] = useState(`${flowId}-0`)
  const { data: instructionTemplate } = useQuery({
    ...consoleQuery.instructionGenerate.template.post.queryOptions({
      input: { body: { type: GeneratorType.code } },
    }),
    retry: 0,
  })
  const instruction = instructionFromSessionStorage ?? instructionTemplate?.data ?? ''
  const instructionEditorKey = `${editorKey}-${instructionTemplate ? 'template' : 'pending'}`

  const isValid = () => {
    if (instruction.trim() === '') {
      toast.error(
        t(($) => $['errorMsg.fieldRequired'], {
          ns: 'common',
          field: t(($) => $['code.instruction'], { ns: 'appDebug' }),
        }),
      )
      return false
    }
    return true
  }

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
      const { error, ...res } = await generateRule({
        flow_id: flowId,
        node_id: nodeId,
        current: currentCode,
        instruction,
        model_config: model,
        ideal_output: ideaOutput,
        language: languageMap[codeLanguages] || 'javascript',
      })
      if ('code' in res && typeof res.code === 'string')
        // not current or current is the same as the template would return a code field
        res.modified = res.code

      if (error) {
        toast.error(error)
      } else {
        addVersion(res)
      }
    } finally {
      setLoadingFalse()
    }
  }

  const [
    isShowConfirmOverwrite,
    { setTrue: showConfirmOverwrite, setFalse: hideShowConfirmOverwrite },
  ] = useBoolean(false)

  const renderLoading = (
    <div className="flex h-full w-0 grow flex-col items-center justify-center space-y-3">
      <Loading />
      <div className="text-[13px] text-text-tertiary">
        {t(($) => $['codegen.loading'], { ns: 'appDebug' })}
      </div>
    </div>
  )

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="h-[min(680px,calc(100dvh-2rem))] max-h-none! w-full min-w-285 overflow-hidden! border-none p-0! text-left align-middle">
        <div className="relative flex h-full min-h-0 flex-wrap">
          <div className="h-full w-142.5 shrink-0 overflow-y-auto border-r border-divider-regular p-6">
            <div className="mb-5">
              <div className={`text-lg leading-7 font-bold ${s.textGradient}`}>
                {t(($) => $['codegen.title'], { ns: 'appDebug' })}
              </div>
              <div className="mt-1 text-[13px] font-normal text-text-tertiary">
                {t(($) => $['codegen.description'], { ns: 'appDebug' })}
              </div>
            </div>
            <div className="mb-4">
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
            <div>
              <div className="text-[0px]">
                <div className="mb-1.5 system-sm-semibold-uppercase text-text-secondary">
                  {t(($) => $['codegen.instruction'], { ns: 'appDebug' })}
                </div>
                <InstructionEditor
                  editorKey={instructionEditorKey}
                  value={instruction}
                  onChange={setInstructionFromSessionStorage}
                  nodeId={nodeId}
                  generatorType={GeneratorType.code}
                  isShowCurrentBlock={!!currentCode}
                />
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
                    {t(($) => $['codegen.generate'], { ns: 'appDebug' })}
                  </span>
                </Button>
              </div>
            </div>
          </div>
          {isLoading && renderLoading}
          {!isLoading && !current && <ResPlaceholder />}
          {!isLoading && current && (
            <div className="h-full w-0 grow bg-background-default-subtle p-6 pb-0">
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
        <AlertDialog
          open={isShowConfirmOverwrite}
          onOpenChange={(open) => !open && hideShowConfirmOverwrite()}
        >
          <AlertDialogContent>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t(($) => $['codegen.overwriteConfirmTitle'], { ns: 'appDebug' })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t(($) => $['codegen.overwriteConfirmMessage'], { ns: 'appDebug' })}
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
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(GetCodeGeneratorResModal)
