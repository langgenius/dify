import type { ChangeEvent } from 'react'
import type { DefaultModel } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Textarea from '@/app/components/base/textarea'
import Tooltip from '@/app/components/base/tooltip'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelSelector from '@/app/components/header/account-setting/model-provider-page/model-selector'

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
  const { t } = useTranslation()
  const {
    data: textGenerationModelList,
  } = useModelList(ModelTypeEnum.textGeneration)
  const summaryIndexModelConfig = useMemo(() => {
    if (!summaryIndexSetting?.model_name || !summaryIndexSetting?.model_provider_name)
      return undefined

    return {
      providerName: summaryIndexSetting?.model_provider_name,
      modelName: summaryIndexSetting?.model_name,
    }
  }, [summaryIndexSetting?.model_name, summaryIndexSetting?.model_provider_name])

  const handleSummaryIndexEnableChange = useCallback((value: boolean) => {
    onSummaryIndexSettingChange?.({
      enable: value,
    })
  }, [onSummaryIndexSettingChange])

  const handleSummaryIndexModelChange = useCallback((model: DefaultModel) => {
    onSummaryIndexSettingChange?.({
      model_provider_name: model.provider,
      model_name: model.model,
    })
  }, [onSummaryIndexSettingChange])

  const handleSummaryIndexPromptChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    onSummaryIndexSettingChange?.({
      summary_prompt: e.target.value,
    })
  }, [onSummaryIndexSettingChange])

  if (entry === 'knowledge-base') {
    return (
      <div>
        <div className="flex h-6 items-center justify-between">
          <div className="system-sm-semibold-uppercase flex items-center text-text-secondary">
            {t('form.summaryAutoGen', { ns: 'datasetSettings' })}
            <Tooltip
              triggerClassName="ml-1 h-4 w-4 shrink-0"
              popupContent={t('form.summaryAutoGenTip', { ns: 'datasetSettings' })}
            >
            </Tooltip>
          </div>
          <Switch
            defaultValue={summaryIndexSetting?.enable ?? false}
            onChange={handleSummaryIndexEnableChange}
            size="md"
          />
        </div>
        {
          summaryIndexSetting?.enable && (
            <div>
              <div className="system-xs-medium-uppercase mb-1.5 mt-2 flex h-6 items-center text-text-tertiary">
                {t('form.summaryModel', { ns: 'datasetSettings' })}
              </div>
              <ModelSelector
                defaultModel={summaryIndexModelConfig && { provider: summaryIndexModelConfig.providerName, model: summaryIndexModelConfig.modelName }}
                modelList={textGenerationModelList}
                onSelect={handleSummaryIndexModelChange}
                readonly={readonly}
                showDeprecatedWarnIcon
              />
              <div className="system-xs-medium-uppercase mt-3 flex h-6 items-center text-text-tertiary">
                {t('form.summaryInstructions', { ns: 'datasetSettings' })}
              </div>
              <Textarea
                value={summaryIndexSetting?.summary_prompt ?? ''}
                onChange={handleSummaryIndexPromptChange}
                disabled={readonly}
                placeholder={t('form.summaryInstructionsPlaceholder', { ns: 'datasetSettings' })}
              />
            </div>
          )
        }
      </div>
    )
  }

  if (entry === 'dataset-settings') {
    return (
      <div className="space-y-4">
        <div className="flex gap-x-1">
          <div className="flex h-7 w-[180px] shrink-0 items-center pt-1">
            <div className="system-sm-semibold text-text-secondary">
              {t('form.summaryAutoGen', { ns: 'datasetSettings' })}
            </div>
          </div>
          <div className="py-1.5">
            <div className="system-sm-semibold flex items-center text-text-secondary">
              <Switch
                className="mr-2"
                defaultValue={summaryIndexSetting?.enable ?? false}
                onChange={handleSummaryIndexEnableChange}
                size="md"
              />
              {
                summaryIndexSetting?.enable ? t('list.status.enabled', { ns: 'datasetDocuments' }) : t('list.status.disabled', { ns: 'datasetDocuments' })
              }
            </div>
            <div className="system-sm-regular mt-2 text-text-tertiary">
              {
                summaryIndexSetting?.enable && t('form.summaryAutoGenTip', { ns: 'datasetSettings' })
              }
              {
                !summaryIndexSetting?.enable && t('form.summaryAutoGenEnableTip', { ns: 'datasetSettings' })
              }
            </div>
          </div>
        </div>
        {
          summaryIndexSetting?.enable && (
            <>
              <div className="flex gap-x-1">
                <div className="flex h-7 w-[180px] shrink-0 items-center pt-1">
                  <div className="system-sm-medium text-text-tertiary">
                    {t('form.summaryModel', { ns: 'datasetSettings' })}
                  </div>
                </div>
                <div className="grow">
                  <ModelSelector
                    defaultModel={summaryIndexModelConfig && { provider: summaryIndexModelConfig.providerName, model: summaryIndexModelConfig.modelName }}
                    modelList={textGenerationModelList}
                    onSelect={handleSummaryIndexModelChange}
                    readonly={readonly}
                    showDeprecatedWarnIcon
                    triggerClassName="h-8"
                  />
                </div>
              </div>
              <div className="flex">
                <div className="flex h-7 w-[180px] shrink-0 items-center pt-1">
                  <div className="system-sm-medium text-text-tertiary">
                    {t('form.summaryInstructions', { ns: 'datasetSettings' })}
                  </div>
                </div>
                <div className="grow">
                  <Textarea
                    value={summaryIndexSetting?.summary_prompt ?? ''}
                    onChange={handleSummaryIndexPromptChange}
                    disabled={readonly}
                    placeholder={t('form.summaryInstructionsPlaceholder', { ns: 'datasetSettings' })}
                  />
                </div>
              </div>
            </>
          )
        }
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex h-6 items-center">
        <Switch
          className="mr-2"
          defaultValue={summaryIndexSetting?.enable ?? false}
          onChange={handleSummaryIndexEnableChange}
          size="md"
        />
        <div className="system-sm-semibold text-text-secondary">
          {t('form.summaryAutoGen', { ns: 'datasetSettings' })}
        </div>
      </div>
      {
        summaryIndexSetting?.enable && (
          <>
            <div>
              <div className="system-sm-medium mb-1.5 flex h-6 items-center text-text-secondary">
                {t('form.summaryModel', { ns: 'datasetSettings' })}
              </div>
              <ModelSelector
                defaultModel={summaryIndexModelConfig && { provider: summaryIndexModelConfig.providerName, model: summaryIndexModelConfig.modelName }}
                modelList={textGenerationModelList}
                onSelect={handleSummaryIndexModelChange}
                readonly={readonly}
                showDeprecatedWarnIcon
                triggerClassName="h-8"
              />
            </div>
            <div>
              <div className="system-sm-medium mb-1.5 flex h-6 items-center text-text-secondary">
                {t('form.summaryInstructions', { ns: 'datasetSettings' })}
              </div>
              <Textarea
                value={summaryIndexSetting?.summary_prompt ?? ''}
                onChange={handleSummaryIndexPromptChange}
                disabled={readonly}
                placeholder={t('form.summaryInstructionsPlaceholder', { ns: 'datasetSettings' })}
              />
            </div>
          </>
        )
      }
    </div>
  )
}
export default memo(SummaryIndexSetting)
