import type { FC } from 'react'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/console'

type ModelBarProps =
  | {
      provider: string
      model: string
    }
  | {
      provider?: never
      model?: never
    }

const useAllModel = () => {
  const { data: textGeneration = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const { data: moderation = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.moderation } },
      select: (response) => response.data,
    }),
  )
  const { data: rerank = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.rerank } },
      select: (response) => response.data,
    }),
  )
  const { data: speech2text = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.speech2text } },
      select: (response) => response.data,
    }),
  )
  const { data: textEmbedding = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textEmbedding } },
      select: (response) => response.data,
    }),
  )
  const { data: tts = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.tts } },
      select: (response) => response.data,
    }),
  )
  const models = useMemo(() => {
    return textGeneration
      .concat(moderation)
      .concat(rerank)
      .concat(speech2text)
      .concat(textEmbedding)
      .concat(tts)
  }, [textGeneration, moderation, rerank, speech2text, textEmbedding, tts])
  if (!textGeneration || !moderation || !rerank || !speech2text || !textEmbedding || !tts)
    return undefined
  return models
}

export const ModelBar: FC<ModelBarProps> = (props) => {
  const { t } = useTranslation()
  const modelList = useAllModel()
  if (props.provider === undefined) {
    const tooltip = t(($) => $['nodes.agent.modelNotSelected'], { ns: 'workflow' })

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="relative">
              <ModelSelector
                models={[]}
                value={undefined}
                size="small"
                surface="workflow"
                showDeprecatedWarnIcon={false}
                disabled
              />
              <StatusDot status="error" className="absolute -top-0.5 -right-0.5" />
              <span className="sr-only">{tooltip}</span>
            </div>
          }
        />
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    )
  }
  const modelInstalled = modelList?.some(
    (provider) =>
      provider.provider === props.provider &&
      provider.models.some((model) => model.model === props.model),
  )
  const showWarn = modelList && !modelInstalled
  if (!modelList) return null

  const modelNotInstalledTooltip = t(($) => $['nodes.agent.modelNotInstallTooltip'], {
    ns: 'workflow',
  })
  const modelSelector = (
    <div className="relative">
      <ModelSelector
        models={modelList}
        value={{
          provider: props.provider,
          model: props.model,
        }}
        size="small"
        surface="workflow"
        showDeprecatedWarnIcon={false}
        disabled
      />
      {showWarn && <StatusDot status="error" className="absolute -top-0.5 -right-0.5" />}
      {showWarn && <span className="sr-only">{modelNotInstalledTooltip}</span>}
    </div>
  )

  if (modelInstalled) return modelSelector

  return (
    <Tooltip>
      <TooltipTrigger render={modelSelector} />
      <TooltipContent>{modelNotInstalledTooltip}</TooltipContent>
    </Tooltip>
  )
}
