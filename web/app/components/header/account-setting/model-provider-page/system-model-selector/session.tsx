import type { DefaultModel } from '../declarations'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { canConfigureModelsAtom } from '../atoms'
import { ModelTypeEnum } from '../declarations'
import { ModelSelector } from '../model-selector'
import { systemModelDialog } from './handle'

type SystemModelLabelKey =
  | 'modelProvider.systemReasoningModel.key'
  | 'modelProvider.embeddingModel.key'
  | 'modelProvider.rerankModel.key'
  | 'modelProvider.speechToTextModel.key'
  | 'modelProvider.ttsModel.key'

type SystemModelTipKey =
  | 'modelProvider.systemReasoningModel.tip'
  | 'modelProvider.embeddingModel.tip'
  | 'modelProvider.rerankModel.tip'
  | 'modelProvider.speechToTextModel.tip'
  | 'modelProvider.ttsModel.tip'

const systemModelTypes = [
  ModelTypeEnum.textGeneration,
  ModelTypeEnum.textEmbedding,
  ModelTypeEnum.rerank,
  ModelTypeEnum.speech2text,
  ModelTypeEnum.tts,
] as const

type DefaultModelDraft = Partial<Record<ModelTypeEnum, DefaultModel>>
type ClearConfirmation = {
  modelType: ModelTypeEnum
  labelKey: SystemModelLabelKey
  open: boolean
}

export default function SystemModelSession() {
  const { t } = useTranslation(['common', 'modelProvider'])
  const [defaultModels, setDefaultModels] = useState<DefaultModelDraft>()
  const saveMutation = useMutation(
    consoleQuery.workspaces.current.defaultModel.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (res) => {
        if (res.result !== 'success') return

        systemModelDialog.close()
      },
    }),
  )
  const isSaving = saveMutation.isPending
  const saveError =
    saveMutation.error?.message ||
    (saveMutation.isError || (saveMutation.isSuccess && saveMutation.data.result !== 'success')
      ? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' })
      : undefined)
  const [clearConfirmation, setClearConfirmation] = useState<ClearConfirmation>()
  const modelLabelId = useId()
  const modelTriggersRef = useRef<Partial<Record<ModelTypeEnum, HTMLButtonElement | null>>>({})
  const canConfigureModels = useAtomValue(canConfigureModelsAtom)
  const { data: textGenerationModelList = [], isPending: isTextGenerationModelListLoading } =
    useQuery(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
        input: { params: { model_type: ModelTypeEnum.textGeneration } },
        select: (response) => response.data,
      }),
    )
  const defaultModelQueries = useQueries({
    queries: systemModelTypes.map((modelType) =>
      consoleQuery.workspaces.current.defaultModel.get.queryOptions({
        input: { query: { model_type: modelType } },
        meta: { errorToast: false },
        refetchOnMount: 'always',
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      }),
    ),
  })
  const { data: embeddingModelList = [], isPending: isEmbeddingModelListLoading } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textEmbedding } },
      select: (response) => response.data,
    }),
  )
  const { data: rerankModelList = [], isPending: isRerankModelListLoading } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.rerank } },
      select: (response) => response.data,
    }),
  )
  const { data: speech2textModelList = [], isPending: isSpeech2textModelListLoading } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.speech2text } },
      select: (response) => response.data,
    }),
  )
  const { data: ttsModelList = [], isPending: isTTSModelListLoading } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.tts } },
      select: (response) => response.data,
    }),
  )

  // Start this mounted editing session only after every default has been refreshed.
  // Later cache updates must not replace the user's draft.
  if (
    !defaultModels &&
    defaultModelQueries.every(
      (query) => query.isFetchedAfterMount && query.isSuccess && !query.isFetching,
    )
  ) {
    const freshDefaults: DefaultModelDraft = {}
    defaultModelQueries.forEach(({ data }, index) => {
      const modelType = systemModelTypes[index]
      if (modelType && data?.data) {
        freshDefaults[modelType] = {
          provider: data.data.provider.provider,
          model: data.data.model,
        }
      }
    })
    setDefaultModels(freshDefaults)
  }

  const failedDefaultModelQuery = !defaultModels
    ? defaultModelQueries.find((query) => query.isError && !query.isFetching)
    : undefined
  const isSystemModelLoading =
    !defaultModels ||
    isTextGenerationModelListLoading ||
    isEmbeddingModelListLoading ||
    isRerankModelListLoading ||
    isSpeech2textModelListLoading ||
    isTTSModelListLoading
  const handleChangeDefaultModel = (modelType: ModelTypeEnum, model: DefaultModel | undefined) => {
    setDefaultModels((current) => ({ ...current, [modelType]: model }))
  }

  const getClearProps = (modelType: ModelTypeEnum, labelKey: SystemModelLabelKey) => ({
    'aria-labelledby': `${modelLabelId}-${labelKey}`,
    triggerRef: (element: HTMLButtonElement | null) => {
      modelTriggersRef.current[modelType] = element
    },
    onClear: canConfigureModels
      ? () => {
          if (
            modelType === ModelTypeEnum.textGeneration ||
            modelType === ModelTypeEnum.speech2text ||
            modelType === ModelTypeEnum.tts
          ) {
            setClearConfirmation({ modelType, labelKey, open: true })
            return
          }
          modelTriggersRef.current[modelType]?.focus()
          handleChangeDefaultModel(modelType, undefined)
        }
      : undefined,
    clearLabel: `${t(($) => $['operation.clear'], { ns: 'common' })} ${t(($) => $[labelKey], { ns: 'modelProvider' })}`,
  })
  const closeClearConfirmation = () => {
    setClearConfirmation((current) => current && { ...current, open: false })
  }
  const handleConfirmClear = () => {
    if (!clearConfirmation || !canConfigureModels) return

    handleChangeDefaultModel(clearConfirmation.modelType, undefined)
    closeClearConfirmation()
  }
  const modelToClearLabel = clearConfirmation
    ? t(($) => $[clearConfirmation.labelKey], { ns: 'modelProvider' })
    : ''

  const renderModelLabel = (labelKey: SystemModelLabelKey, tipKey: SystemModelTipKey) => {
    const tipText = t(($) => $[tipKey], { ns: 'modelProvider' })

    return (
      <div className="flex min-h-6 items-center text-[13px] font-medium text-text-secondary">
        <span id={`${modelLabelId}-${labelKey}`}>
          {t(($) => $[labelKey], { ns: 'modelProvider' })}
        </span>
        <Infotip>
          <InfotipTrigger
            aria-labelledby={`${modelLabelId}-${labelKey}`}
            className="ms-0.5 text-text-tertiary"
          />
          <InfotipContent aria-labelledby={`${modelLabelId}-${labelKey}`} className="w-65.25">
            {tipText}
          </InfotipContent>
        </Infotip>
      </div>
    )
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canConfigureModels || isSystemModelLoading || isSaving || !defaultModels) return
        saveMutation.mutate({
          body: {
            model_settings: systemModelTypes.map((modelType) => ({
              model_type: modelType,
              provider: defaultModels[modelType]?.provider ?? null,
              model: defaultModels[modelType]?.model ?? null,
            })),
          },
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['modelProvider.systemModelSettingsTitle'], { ns: 'modelProvider' })}
        </DialogTitle>
        <DialogDescription>
          {t(($) => $['modelProvider.systemModelSettingsDesc'], { ns: 'modelProvider' })}
        </DialogDescription>
        <DialogHeaderCloseButton
          disabled={isSaving}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <DialogBody>
        {failedDefaultModelQuery ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3">
            <p role="alert" className="text-sm text-text-destructive">
              {failedDefaultModelQuery.error?.message || t(($) => $.error, { ns: 'common' })}
            </p>
            <Button
              onClick={() => {
                defaultModelQueries
                  .filter((query) => query.isError)
                  .forEach((query) => {
                    void query.refetch()
                  })
              }}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        ) : isSystemModelLoading ? (
          <div
            role="status"
            aria-label={t(($) => $.loading, { ns: 'common' })}
            className="flex h-full min-h-48 items-center justify-center"
          >
            <span
              aria-hidden
              className="i-ri-loader-2-line size-5 animate-spin text-text-tertiary"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              {renderModelLabel(
                'modelProvider.systemReasoningModel.key',
                'modelProvider.systemReasoningModel.tip',
              )}
              <div>
                <ModelSelector
                  disabled={isSaving}
                  {...getClearProps(
                    ModelTypeEnum.textGeneration,
                    'modelProvider.systemReasoningModel.key',
                  )}
                  value={defaultModels?.[ModelTypeEnum.textGeneration]}
                  models={textGenerationModelList}
                  onOpenProviderSettings={() => systemModelDialog.close()}
                  showModelMeta={false}
                  onValueChange={(model) =>
                    handleChangeDefaultModel(ModelTypeEnum.textGeneration, model)
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel(
                'modelProvider.embeddingModel.key',
                'modelProvider.embeddingModel.tip',
              )}
              <div>
                <ModelSelector
                  disabled={isSaving}
                  {...getClearProps(
                    ModelTypeEnum.textEmbedding,
                    'modelProvider.embeddingModel.key',
                  )}
                  value={defaultModels?.[ModelTypeEnum.textEmbedding]}
                  models={embeddingModelList}
                  onOpenProviderSettings={() => systemModelDialog.close()}
                  showModelMeta={false}
                  onValueChange={(model) =>
                    handleChangeDefaultModel(ModelTypeEnum.textEmbedding, model)
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.rerankModel.key', 'modelProvider.rerankModel.tip')}
              <div>
                <ModelSelector
                  disabled={isSaving}
                  {...getClearProps(ModelTypeEnum.rerank, 'modelProvider.rerankModel.key')}
                  value={defaultModels?.[ModelTypeEnum.rerank]}
                  models={rerankModelList}
                  onOpenProviderSettings={() => systemModelDialog.close()}
                  showModelMeta={false}
                  onValueChange={(model) => handleChangeDefaultModel(ModelTypeEnum.rerank, model)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel(
                'modelProvider.speechToTextModel.key',
                'modelProvider.speechToTextModel.tip',
              )}
              <div>
                <ModelSelector
                  disabled={isSaving}
                  {...getClearProps(
                    ModelTypeEnum.speech2text,
                    'modelProvider.speechToTextModel.key',
                  )}
                  value={defaultModels?.[ModelTypeEnum.speech2text]}
                  models={speech2textModelList}
                  onOpenProviderSettings={() => systemModelDialog.close()}
                  showModelMeta={false}
                  onValueChange={(model) =>
                    handleChangeDefaultModel(ModelTypeEnum.speech2text, model)
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              {renderModelLabel('modelProvider.ttsModel.key', 'modelProvider.ttsModel.tip')}
              <div>
                <ModelSelector
                  disabled={isSaving}
                  {...getClearProps(ModelTypeEnum.tts, 'modelProvider.ttsModel.key')}
                  value={defaultModels?.[ModelTypeEnum.tts]}
                  models={ttsModelList}
                  onOpenProviderSettings={() => systemModelDialog.close()}
                  showModelMeta={false}
                  onValueChange={(model) => handleChangeDefaultModel(ModelTypeEnum.tts, model)}
                />
              </div>
            </div>
          </div>
        )}
        {saveError && (
          <p role="alert" className="mt-4 text-sm text-text-destructive">
            {saveError}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button className="min-w-18" disabled={isSaving} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button
          className="min-w-18"
          variant="primary"
          type="submit"
          loading={isSaving}
          disabled={!canConfigureModels || isSystemModelLoading}
        >
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
      <AlertDialog
        open={clearConfirmation?.open ?? false}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeClearConfirmation()
        }}
      >
        <AlertDialogContent
          backdropProps={{ forceRender: true }}
          finalFocus={() =>
            clearConfirmation && !defaultModels?.[clearConfirmation.modelType]
              ? (modelTriggersRef.current[clearConfirmation.modelType] ?? true)
              : true
          }
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['modelProvider.clearDefaultModel.title'], {
                ns: 'modelProvider',
                modelType: modelToClearLabel,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['modelProvider.clearDefaultModel.description'], {
                ns: 'modelProvider',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={!canConfigureModels} onClick={handleConfirmClear}>
              {t(($) => $['operation.clear'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
