import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { GraphIndexSetting as GraphIndexSettingType } from '@/models/datasets'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import { Slider } from '@langgenius/dify-ui/slider'
import { Switch } from '@langgenius/dify-ui/switch'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/console'

const MIN_MAX_DEPTH = 1
const MAX_MAX_DEPTH = 4
const DEFAULT_MAX_DEPTH = 2

type GraphIndexSettingProps = {
  graphIndexSetting?: GraphIndexSettingType
  onGraphIndexSettingChange?: (payload: GraphIndexSettingType) => void
  readonly?: boolean
}

const GraphIndexSetting = ({
  graphIndexSetting,
  onGraphIndexSettingChange,
  readonly = false,
}: GraphIndexSettingProps) => {
  const { t } = useTranslation()
  const { data: textGenerationModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )

  const graphModelConfig = useMemo(() => {
    if (!graphIndexSetting?.model_name || !graphIndexSetting?.model_provider_name) return undefined

    return {
      provider: graphIndexSetting.model_provider_name,
      model: graphIndexSetting.model_name,
    }
  }, [graphIndexSetting?.model_name, graphIndexSetting?.model_provider_name])

  const maxDepth = graphIndexSetting?.max_depth ?? DEFAULT_MAX_DEPTH

  const handleEnabledChange = useCallback(
    (value: boolean) => {
      onGraphIndexSettingChange?.({ enabled: value })
    },
    [onGraphIndexSettingChange],
  )

  const handleModelChange = useCallback(
    (model: DefaultModel) => {
      onGraphIndexSettingChange?.({
        model_provider_name: model.provider,
        model_name: model.model,
      })
    },
    [onGraphIndexSettingChange],
  )

  const handleMaxDepthChange = useCallback(
    (value: number | null) => {
      onGraphIndexSettingChange?.({ max_depth: value ?? DEFAULT_MAX_DEPTH })
    },
    [onGraphIndexSettingChange],
  )

  const handleQueryFallbackChange = useCallback(
    (value: boolean) => {
      onGraphIndexSettingChange?.({ llm_query_fallback: value })
    },
    [onGraphIndexSettingChange],
  )

  const maxDepthLabel = t(($) => $['form.graphIndex.maxDepth'], { ns: 'datasetSettings' })
  const queryFallbackLabel = t(($) => $['form.graphIndex.queryFallback'], { ns: 'datasetSettings' })

  return (
    <div className="space-y-4">
      <div className="flex gap-x-1">
        <div className="flex h-7 w-45 shrink-0 items-center pt-1">
          <div className="system-sm-semibold text-text-secondary">
            {t(($) => $['form.graphIndex.title'], { ns: 'datasetSettings' })}
          </div>
        </div>
        <div className="py-1.5">
          <div className="flex items-center system-sm-semibold text-text-secondary">
            <Switch
              className="mr-2"
              checked={graphIndexSetting?.enabled ?? false}
              onCheckedChange={handleEnabledChange}
              size="md"
              disabled={readonly}
            />
            {graphIndexSetting?.enabled
              ? t(($) => $['list.status.enabled'], { ns: 'datasetDocuments' })
              : t(($) => $['list.status.disabled'], { ns: 'datasetDocuments' })}
          </div>
          <div className="mt-2 system-sm-regular text-text-tertiary">
            {t(($) => $['form.graphIndex.description'], { ns: 'datasetSettings' })}
          </div>
        </div>
      </div>
      {graphIndexSetting?.enabled && (
        <>
          <div className="flex gap-x-1">
            <div className="flex h-7 w-45 shrink-0 items-center pt-1">
              <div className="system-sm-medium text-text-tertiary">
                {t(($) => $['form.graphIndex.model'], { ns: 'datasetSettings' })}
              </div>
            </div>
            <div className="grow">
              <ModelSelector
                value={graphModelConfig}
                models={textGenerationModelList}
                onValueChange={handleModelChange}
                disabled={readonly}
                showDeprecatedWarnIcon
              />
              <div className="mt-2 system-xs-regular text-text-tertiary">
                {t(($) => $['form.graphIndex.modelTip'], { ns: 'datasetSettings' })}
              </div>
              {/* One LLM call per chunk is easy to miss until the invoice
                arrives, so the cost is stated where the model is chosen. */}
              <div className="mt-1 flex items-start gap-x-1 system-xs-regular text-text-warning-secondary">
                <span className="mt-0.5 i-ri-alert-fill size-4 shrink-0" />
                <span>{t(($) => $['form.graphIndex.costTip'], { ns: 'datasetSettings' })}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-x-1">
            <div className="flex h-7 w-45 shrink-0 items-center pt-1">
              <div className="system-sm-medium text-text-tertiary">{maxDepthLabel}</div>
            </div>
            <div className="grow">
              <div className="flex items-center gap-x-1">
                <Slider
                  className="mr-3 w-51.5 shrink-0"
                  value={maxDepth}
                  min={MIN_MAX_DEPTH}
                  max={MAX_MAX_DEPTH}
                  onValueChange={handleMaxDepthChange}
                  aria-label={maxDepthLabel}
                  disabled={readonly}
                />
                <NumberField
                  className="w-18.5 shrink-0"
                  min={MIN_MAX_DEPTH}
                  max={MAX_MAX_DEPTH}
                  value={maxDepth}
                  onValueChange={handleMaxDepthChange}
                  disabled={readonly}
                >
                  <NumberFieldGroup>
                    <NumberFieldInput
                      aria-label={maxDepthLabel}
                      className="w-12 flex-none px-2 text-center"
                    />
                    <NumberFieldControls>
                      <NumberFieldIncrement />
                      <NumberFieldDecrement />
                    </NumberFieldControls>
                  </NumberFieldGroup>
                </NumberField>
              </div>
              <div className="mt-2 system-xs-regular text-text-tertiary">
                {t(($) => $['form.graphIndex.maxDepthTip'], { ns: 'datasetSettings' })}
              </div>
            </div>
          </div>
          <div className="flex gap-x-1">
            <div className="flex h-7 w-45 shrink-0 items-center pt-1">
              <div className="system-sm-medium text-text-tertiary">{queryFallbackLabel}</div>
            </div>
            <div className="grow py-1.5">
              <Switch
                aria-label={queryFallbackLabel}
                checked={graphIndexSetting?.llm_query_fallback ?? true}
                onCheckedChange={handleQueryFallbackChange}
                size="md"
                disabled={readonly}
              />
              <div className="mt-2 system-xs-regular text-text-tertiary">
                {t(($) => $['form.graphIndex.queryFallbackTip'], { ns: 'datasetSettings' })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(GraphIndexSetting)
