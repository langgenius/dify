'use client'

import type { FC } from 'react'
import type { KnowledgeRetrievalV2Mode, KnowledgeRetrievalV2RerankingModel } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import ScoreThresholdItem from '@/app/components/base/param-item/score-threshold-item'
import TopKItem from '@/app/components/base/param-item/top-k-item'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useModelListAndDefaultModelAndCurrentProviderAndModel } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { ModelSelector } from '@/app/components/header/account-setting/model-provider-page/model-selector'

const i18nPrefix = 'nodes.knowledgeRetrievalV2'
const DEFAULT_SCORE_THRESHOLD = 0.5

type Props = Readonly<{
  mode?: KnowledgeRetrievalV2Mode
  onModeChange: (mode?: KnowledgeRetrievalV2Mode) => void
  onRerankingModelChange: (model?: KnowledgeRetrievalV2RerankingModel) => void
  onScoreThresholdChange: (scoreThreshold: number | null) => void
  onTopKChange: (topK: number) => void
  readonly?: boolean
  rerankingModel?: KnowledgeRetrievalV2RerankingModel
  scoreThreshold?: number | null
  topK: number
}>

const RecallSettings: FC<Props> = ({
  mode,
  onModeChange,
  onRerankingModelChange,
  onScoreThresholdChange,
  onTopKChange,
  readonly,
  rerankingModel,
  scoreThreshold,
  topK,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { currentModel, currentProvider, modelList } =
    useModelListAndDefaultModelAndCurrentProviderAndModel(ModelTypeEnum.rerank)
  const systemModel = useMemo(
    () =>
      currentProvider && currentModel
        ? { provider: currentProvider.provider, model: currentModel.model }
        : undefined,
    [currentModel, currentProvider],
  )
  const selectedModel = rerankingModel ?? systemModel
  const modes: Array<{ label: string; value: KnowledgeRetrievalV2Mode | 'space-default' }> = [
    {
      label: t(($) => $[`${i18nPrefix}.mode.spaceDefault`], { ns: 'workflow' }),
      value: 'space-default',
    },
    { label: t(($) => $[`${i18nPrefix}.mode.fast`], { ns: 'workflow' }), value: 'fast' },
    { label: t(($) => $[`${i18nPrefix}.mode.deep`], { ns: 'workflow' }), value: 'deep' },
    { label: t(($) => $[`${i18nPrefix}.mode.research`], { ns: 'workflow' }), value: 'research' },
  ]
  const selectedMode = modes.find((item) => item.value === (mode ?? 'space-default'))!
  const usingSystemModel = !rerankingModel

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (readonly) return
        setOpen(nextOpen)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="small"
            disabled={readonly}
            className="data-popup-open:bg-components-button-ghost-bg-hover"
          >
            <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
            {t(($) => $.retrievalSettings, { ns: 'dataset' })}
          </Button>
        }
      />
      <PopoverContent
        placement="bottom-end"
        sideOffset={0}
        alignOffset={-2}
        popupClassName="border-none bg-transparent shadow-none"
      >
        <div className="w-101 rounded-2xl border border-components-panel-border bg-components-panel-bg px-4 pt-3 pb-4 shadow-xl">
          <div className="system-xl-semibold text-text-primary">
            {t(($) => $.retrievalSettings, { ns: 'dataset' })}
          </div>
          <div className="system-xs-regular text-text-tertiary">
            {t(($) => $.defaultRetrievalTip, { ns: 'dataset' })}
          </div>

          <div className="my-2 flex flex-col items-center py-1">
            <div className="mr-2 mb-2 shrink-0 system-xs-semibold-uppercase text-text-secondary">
              {t(($) => $.rerankSettings, { ns: 'dataset' })}
            </div>
            <Divider bgStyle="gradient" className="m-0 h-px!" />
          </div>

          <div className="space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <div className="system-sm-semibold text-text-secondary">
                  {t(($) => $['modelProvider.rerankModel.key'], { ns: 'common' })}
                </div>
                {usingSystemModel ? (
                  <span className="system-xs-medium text-text-tertiary">
                    {t(($) => $['modelProvider.defaultConfig'], { ns: 'common' })}
                  </span>
                ) : (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => onRerankingModelChange(undefined)}
                  >
                    {t(($) => $['operation.reset'], { ns: 'common' })}
                  </Button>
                )}
              </div>
              <ModelSelector
                surface="workflow"
                value={selectedModel}
                models={modelList}
                disabled={readonly}
                onValueChange={(value) =>
                  onRerankingModelChange({ provider: value.provider, model: value.model })
                }
              />
              {usingSystemModel && (
                <div className="mt-1 system-xs-regular text-text-tertiary">
                  {systemModel
                    ? t(($) => $['modelProvider.systemModelSettingsDesc'], { ns: 'common' })
                    : t(($) => $['modelProvider.noneConfigured'], { ns: 'common' })}
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 system-sm-semibold text-text-secondary">
                {t(($) => $[`${i18nPrefix}.mode.title`], { ns: 'workflow' })}
              </div>
              <Select
                value={selectedMode.value}
                disabled={readonly}
                onValueChange={(value) => {
                  if (!value) return
                  onModeChange(
                    value === 'space-default' ? undefined : (value as KnowledgeRetrievalV2Mode),
                  )
                }}
              >
                <SelectTrigger className="w-full">{selectedMode.label}</SelectTrigger>
                <SelectContent>
                  {modes.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      <SelectItemText>{item.label}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === 'research' && (
                <div className="mt-1 system-xs-regular text-text-warning">
                  {t(($) => $[`${i18nPrefix}.mode.researchHint`], { ns: 'workflow' })}
                </div>
              )}
            </div>

            <TopKItem
              value={topK}
              enable
              disabled={readonly}
              onChange={(_, value) => onTopKChange(value)}
            />
            <ScoreThresholdItem
              value={scoreThreshold ?? DEFAULT_SCORE_THRESHOLD}
              enable={scoreThreshold !== null && scoreThreshold !== undefined}
              hasSwitch
              disabled={readonly}
              onChange={(_, value) => onScoreThresholdChange(value)}
              onSwitchChange={(_, enabled) =>
                onScoreThresholdChange(enabled ? (scoreThreshold ?? DEFAULT_SCORE_THRESHOLD) : null)
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default RecallSettings
