import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'
import { consoleQuery } from '@/service/console'

type SummaryIndexSettingProps = {
  entry?: 'knowledge-base' | 'dataset-settings' | 'create-document'
  summaryIndexSetting?: SummaryIndexSettingType
  onSummaryIndexSettingChange?: (payload: SummaryIndexSettingType) => void
  readonly?: boolean
}
const SummaryIndexSetting = ({
  entry = 'knowledge-base',
  summaryIndexSetting,
  onSummaryIndexSettingChange,
  readonly = false,
}: SummaryIndexSettingProps) => {
  const { t } = useTranslation(['datasetDocuments', 'datasetSettings'])
  const summaryLabelId = useId()
  const summaryModelLabelId = useId()
  const { data: textGenerationModelList = [] } = useQuery(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
      select: (response) => response.data,
    }),
  )
  const summaryIndexModelConfig = useMemo(() => {
    if (!summaryIndexSetting?.model_name || !summaryIndexSetting?.model_provider_name)
      return undefined

    return {
      providerName: summaryIndexSetting?.model_provider_name,
      modelName: summaryIndexSetting?.model_name,
    }
  }, [summaryIndexSetting?.model_name, summaryIndexSetting?.model_provider_name])

  const handleSummaryIndexEnableChange = useCallback(
    (value: boolean) => {
      onSummaryIndexSettingChange?.({
        enable: value,
      })
    },
    [onSummaryIndexSettingChange],
  )

  const handleSummaryIndexModelChange = useCallback(
    (model: DefaultModel) => {
      onSummaryIndexSettingChange?.({
        model_provider_name: model.provider,
        model_name: model.model,
      })
    },
    [onSummaryIndexSettingChange],
  )

  const handleSummaryIndexPromptChange = useCallback(
    (value: string) => {
      onSummaryIndexSettingChange?.({
        summary_prompt: value,
      })
    },
    [onSummaryIndexSettingChange],
  )

  if (entry === 'knowledge-base') {
    return (
      <div>
        <div className="flex h-6 items-center justify-between">
          <div className="flex items-center system-sm-semibold-uppercase text-text-secondary">
            <span id={summaryLabelId}>
              {t(($) => $['form.summaryAutoGen'], { ns: 'datasetSettings' })}
            </span>
            <Infotip>
              <InfotipTrigger aria-labelledby={summaryLabelId} className="ml-1" />
              <InfotipContent aria-labelledby={summaryLabelId}>
                {t(($) => $['form.summaryAutoGenTip'], { ns: 'datasetSettings' })}
              </InfotipContent>
            </Infotip>
          </div>
          <Switch
            aria-labelledby={summaryLabelId}
            checked={summaryIndexSetting?.enable ?? false}
            onCheckedChange={handleSummaryIndexEnableChange}
            size="md"
            disabled={readonly}
          />
        </div>
        {summaryIndexSetting?.enable && (
          <div>
            <div
              id={summaryModelLabelId}
              className="mt-2 mb-1.5 flex h-6 items-center system-xs-medium-uppercase text-text-tertiary"
            >
              {t(($) => $['form.summaryModel'], { ns: 'datasetSettings' })}
            </div>
            <ModelSelector
              aria-labelledby={summaryModelLabelId}
              value={
                summaryIndexModelConfig && {
                  provider: summaryIndexModelConfig.providerName,
                  model: summaryIndexModelConfig.modelName,
                }
              }
              models={textGenerationModelList}
              onValueChange={handleSummaryIndexModelChange}
              disabled={readonly}
              showDeprecatedWarnIcon
            />
            <div className="mt-3 flex h-6 items-center system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
            </div>
            <Textarea
              aria-label={t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
              value={summaryIndexSetting?.summary_prompt ?? ''}
              onValueChange={handleSummaryIndexPromptChange}
              disabled={readonly}
              placeholder={t(($) => $['form.summaryInstructionsPlaceholder'], {
                ns: 'datasetSettings',
              })}
            />
          </div>
        )}
      </div>
    )
  }

  if (entry === 'dataset-settings') {
    return (
      <div className="space-y-4">
        <div className="flex min-w-0 flex-col gap-2 @3xl/settings:flex-row @3xl/settings:gap-x-1">
          <div className="flex shrink-0 items-center pt-1 @3xl/settings:w-45">
            <div id={summaryLabelId} className="system-sm-semibold text-text-secondary">
              {t(($) => $['form.summaryAutoGen'], { ns: 'datasetSettings' })}
            </div>
          </div>
          <div className="py-1.5">
            <div className="flex items-center system-sm-semibold text-text-secondary">
              <Switch
                aria-labelledby={summaryLabelId}
                className="mr-2"
                checked={summaryIndexSetting?.enable ?? false}
                onCheckedChange={handleSummaryIndexEnableChange}
                size="md"
                disabled={readonly}
              />
              {summaryIndexSetting?.enable
                ? t(($) => $['list.status.enabled'], { ns: 'datasetDocuments' })
                : t(($) => $['list.status.disabled'], { ns: 'datasetDocuments' })}
            </div>
            <div className="mt-2 system-sm-regular text-text-tertiary">
              {summaryIndexSetting?.enable &&
                t(($) => $['form.summaryAutoGenTip'], { ns: 'datasetSettings' })}
              {!summaryIndexSetting?.enable &&
                t(($) => $['form.summaryAutoGenEnableTip'], { ns: 'datasetSettings' })}
            </div>
          </div>
        </div>
        {summaryIndexSetting?.enable && (
          <>
            <div className="flex min-w-0 flex-col gap-2 @3xl/settings:flex-row @3xl/settings:gap-x-1">
              <div className="flex shrink-0 items-center pt-1 @3xl/settings:w-45">
                <div id={summaryModelLabelId} className="system-sm-medium text-text-tertiary">
                  {t(($) => $['form.summaryModel'], { ns: 'datasetSettings' })}
                </div>
              </div>
              <div className="min-w-0 grow">
                <ModelSelector
                  aria-labelledby={summaryModelLabelId}
                  value={
                    summaryIndexModelConfig && {
                      provider: summaryIndexModelConfig.providerName,
                      model: summaryIndexModelConfig.modelName,
                    }
                  }
                  models={textGenerationModelList}
                  onValueChange={handleSummaryIndexModelChange}
                  disabled={readonly}
                  showDeprecatedWarnIcon
                />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-2 @3xl/settings:flex-row">
              <div className="flex shrink-0 items-center pt-1 @3xl/settings:w-45">
                <div className="system-sm-medium text-text-tertiary">
                  {t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
                </div>
              </div>
              <div className="min-w-0 grow">
                <Textarea
                  aria-label={t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
                  value={summaryIndexSetting?.summary_prompt ?? ''}
                  onValueChange={handleSummaryIndexPromptChange}
                  disabled={readonly}
                  placeholder={t(($) => $['form.summaryInstructionsPlaceholder'], {
                    ns: 'datasetSettings',
                  })}
                />
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex h-6 items-center">
        <Switch
          aria-labelledby={summaryLabelId}
          className="mr-2"
          checked={summaryIndexSetting?.enable ?? false}
          onCheckedChange={handleSummaryIndexEnableChange}
          size="md"
          disabled={readonly}
        />
        <div id={summaryLabelId} className="system-sm-semibold text-text-secondary">
          {t(($) => $['form.summaryAutoGen'], { ns: 'datasetSettings' })}
        </div>
      </div>
      {summaryIndexSetting?.enable && (
        <>
          <div>
            <div
              id={summaryModelLabelId}
              className="mb-1.5 flex h-6 items-center system-sm-medium text-text-secondary"
            >
              {t(($) => $['form.summaryModel'], { ns: 'datasetSettings' })}
            </div>
            <ModelSelector
              aria-labelledby={summaryModelLabelId}
              value={
                summaryIndexModelConfig && {
                  provider: summaryIndexModelConfig.providerName,
                  model: summaryIndexModelConfig.modelName,
                }
              }
              models={textGenerationModelList}
              onValueChange={handleSummaryIndexModelChange}
              disabled={readonly}
              showDeprecatedWarnIcon
            />
          </div>
          <div>
            <div className="mb-1.5 flex h-6 items-center system-sm-medium text-text-secondary">
              {t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
            </div>
            <Textarea
              aria-label={t(($) => $['form.summaryInstructions'], { ns: 'datasetSettings' })}
              value={summaryIndexSetting?.summary_prompt ?? ''}
              onValueChange={handleSummaryIndexPromptChange}
              disabled={readonly}
              placeholder={t(($) => $['form.summaryInstructionsPlaceholder'], {
                ns: 'datasetSettings',
              })}
            />
          </div>
        </>
      )}
    </div>
  )
}
export default memo(SummaryIndexSetting)
