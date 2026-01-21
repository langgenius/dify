'use client'

import type { FC } from 'react'
import type { PreProcessingRule, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import {
  RiAlertFill,
  RiSearchEyeLine,
} from '@remixicon/react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'
import Tooltip from '@/app/components/base/tooltip'
import SummaryIndexSetting from '@/app/components/datasets/settings/summary-index-setting'
import { IS_CE_EDITION } from '@/config'
import { ChunkingMode } from '@/models/datasets'
import SettingCog from '../../assets/setting-gear-mod.svg'
import s from '../index.module.css'
import LanguageSelect from '../language-select'
import { DelimiterInput, MaxLengthInput, OverlapInput } from './inputs'
import { OptionCard } from './option-card'

type TextLabelProps = {
  children: React.ReactNode
}

const TextLabel: FC<TextLabelProps> = ({ children }) => {
  return <label className="system-sm-semibold text-text-secondary">{children}</label>
}

type GeneralChunkingOptionsProps = {
  // State
  segmentIdentifier: string
  maxChunkLength: number
  overlap: number
  rules: PreProcessingRule[]
  currentDocForm: ChunkingMode
  docLanguage: string
  // Flags
  isActive: boolean
  isInUpload: boolean
  isNotUploadInEmptyDataset: boolean
  hasCurrentDatasetDocForm: boolean
  // Actions
  onSegmentIdentifierChange: (value: string) => void
  onMaxChunkLengthChange: (value: number) => void
  onOverlapChange: (value: number) => void
  onRuleToggle: (id: string) => void
  onDocFormChange: (form: ChunkingMode) => void
  onDocLanguageChange: (lang: string) => void
  onPreview: () => void
  onReset: () => void
  // Locale
  locale: string
  showSummaryIndexSetting?: boolean
  summaryIndexSetting?: SummaryIndexSettingType
  onSummaryIndexSettingChange?: (payload: SummaryIndexSettingType) => void
}

export const GeneralChunkingOptions: FC<GeneralChunkingOptionsProps> = ({
  segmentIdentifier,
  maxChunkLength,
  overlap,
  rules,
  currentDocForm,
  docLanguage,
  isActive,
  isInUpload,
  isNotUploadInEmptyDataset,
  hasCurrentDatasetDocForm,
  onSegmentIdentifierChange,
  onMaxChunkLengthChange,
  onOverlapChange,
  onRuleToggle,
  onDocFormChange,
  onDocLanguageChange,
  onPreview,
  onReset,
  locale,
  showSummaryIndexSetting,
  summaryIndexSetting,
  onSummaryIndexSettingChange,
}) => {
  const { t } = useTranslation()

  const getRuleName = (key: string): string => {
    const ruleNameMap: Record<string, string> = {
      remove_extra_spaces: t('stepTwo.removeExtraSpaces', { ns: 'datasetCreation' }),
      remove_urls_emails: t('stepTwo.removeUrlEmails', { ns: 'datasetCreation' }),
      remove_stopwords: t('stepTwo.removeStopwords', { ns: 'datasetCreation' }),
    }
    return ruleNameMap[key] ?? key
  }

  return (
    <OptionCard
      className="mb-2 bg-background-section"
      title={t('stepTwo.general', { ns: 'datasetCreation' })}
      icon={<Image width={20} height={20} src={SettingCog} alt={t('stepTwo.general', { ns: 'datasetCreation' })} />}
      activeHeaderClassName="bg-dataset-option-card-blue-gradient"
      description={t('stepTwo.generalTip', { ns: 'datasetCreation' })}
      isActive={isActive}
      onSwitched={() => onDocFormChange(ChunkingMode.text)}
      actions={(
        <>
          <Button variant="secondary-accent" onClick={onPreview}>
            <RiSearchEyeLine className="mr-0.5 h-4 w-4" />
            {t('stepTwo.previewChunk', { ns: 'datasetCreation' })}
          </Button>
          <Button variant="ghost" onClick={onReset}>
            {t('stepTwo.reset', { ns: 'datasetCreation' })}
          </Button>
        </>
      )}
      noHighlight={isInUpload && isNotUploadInEmptyDataset}
    >
      <div className="flex flex-col gap-y-4">
        <div className="flex gap-3">
          <DelimiterInput
            value={segmentIdentifier}
            onChange={e => onSegmentIdentifierChange(e.target.value)}
          />
          <MaxLengthInput
            unit="characters"
            value={maxChunkLength}
            onChange={onMaxChunkLengthChange}
          />
          <OverlapInput
            unit="characters"
            value={overlap}
            min={1}
            onChange={onOverlapChange}
          />
        </div>
        <div className="flex w-full flex-col">
          <div className="flex items-center gap-x-2">
            <div className="inline-flex shrink-0">
              <TextLabel>{t('stepTwo.rules', { ns: 'datasetCreation' })}</TextLabel>
            </div>
            <Divider className="grow" bgStyle="gradient" />
          </div>
          <div className="mt-1">
            {rules.map(rule => (
              <div
                key={rule.id}
                className={s.ruleItem}
                onClick={() => onRuleToggle(rule.id)}
              >
                <Checkbox checked={rule.enabled} />
                <label className="system-sm-regular ml-2 cursor-pointer text-text-secondary">
                  {getRuleName(rule.id)}
                </label>
              </div>
            ))}
            {
              showSummaryIndexSetting && (
                <div className="mt-3">
                  <SummaryIndexSetting
                    entry="create-document"
                    summaryIndexSetting={summaryIndexSetting}
                    onSummaryIndexSettingChange={onSummaryIndexSettingChange}
                  />
                </div>
              )
            }
            {IS_CE_EDITION && (
              <>
                <Divider type="horizontal" className="my-4 bg-divider-subtle" />
                <div className="flex items-center py-0.5">
                  <div
                    className="flex items-center"
                    onClick={() => {
                      if (hasCurrentDatasetDocForm)
                        return
                      if (currentDocForm === ChunkingMode.qa)
                        onDocFormChange(ChunkingMode.text)
                      else
                        onDocFormChange(ChunkingMode.qa)
                    }}
                  >
                    <Checkbox
                      checked={currentDocForm === ChunkingMode.qa}
                      disabled={hasCurrentDatasetDocForm}
                    />
                    <label className="system-sm-regular ml-2 cursor-pointer text-text-secondary">
                      {t('stepTwo.useQALanguage', { ns: 'datasetCreation' })}
                    </label>
                  </div>
                  <LanguageSelect
                    currentLanguage={docLanguage || locale}
                    onSelect={onDocLanguageChange}
                    disabled={currentDocForm !== ChunkingMode.qa}
                  />
                  <Tooltip popupContent={t('stepTwo.QATip', { ns: 'datasetCreation' })} />
                </div>
                {currentDocForm === ChunkingMode.qa && (
                  <div
                    style={{
                      background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.1) 0%, rgba(255, 255, 255, 0.00) 100%)',
                    }}
                    className="mt-2 flex h-10 items-center gap-2 rounded-xl border border-components-panel-border px-3 text-xs shadow-xs backdrop-blur-[5px]"
                  >
                    <RiAlertFill className="size-4 text-text-warning-secondary" />
                    <span className="system-xs-medium text-text-primary">
                      {t('stepTwo.QATip', { ns: 'datasetCreation' })}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </OptionCard>
  )
}
