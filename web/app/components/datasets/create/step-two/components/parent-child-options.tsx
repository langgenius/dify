'use client'

import type { FC } from 'react'
import type { ParentChildConfig } from '../hooks'
import type { ParentMode, PreProcessingRule, SummaryIndexSetting as SummaryIndexSettingType } from '@/models/datasets'
import { RiSearchEyeLine } from '@remixicon/react'
import Image from 'next/image'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'
import Divider from '@/app/components/base/divider'
import { ParentChildChunk } from '@/app/components/base/icons/src/vender/knowledge'
import RadioCard from '@/app/components/base/radio-card'
import SummaryIndexSetting from '@/app/components/datasets/settings/summary-index-setting'
import { ChunkingMode } from '@/models/datasets'
import FileList from '../../assets/file-list-3-fill.svg'
import Note from '../../assets/note-mod.svg'
import BlueEffect from '../../assets/option-card-effect-blue.svg'
import s from '../index.module.css'
import { DelimiterInput, MaxLengthInput } from './inputs'
import { OptionCard } from './option-card'

type TextLabelProps = {
  children: React.ReactNode
}

const TextLabel: FC<TextLabelProps> = ({ children }) => {
  return <label className="system-sm-semibold text-text-secondary">{children}</label>
}

type ParentChildOptionsProps = {
  // State
  parentChildConfig: ParentChildConfig
  rules: PreProcessingRule[]
  summaryIndexSetting?: SummaryIndexSettingType
  onSummaryIndexSettingChange?: (payload: SummaryIndexSettingType) => void
  currentDocForm: ChunkingMode
  // Flags
  isActive: boolean
  isInUpload: boolean
  isNotUploadInEmptyDataset: boolean
  // Actions
  onDocFormChange: (form: ChunkingMode) => void
  onChunkForContextChange: (mode: ParentMode) => void
  onParentDelimiterChange: (value: string) => void
  onParentMaxLengthChange: (value: number) => void
  onChildDelimiterChange: (value: string) => void
  onChildMaxLengthChange: (value: number) => void
  onRuleToggle: (id: string) => void
  onPreview: () => void
  onReset: () => void
  showSummaryIndexSetting?: boolean
}

export const ParentChildOptions: FC<ParentChildOptionsProps> = ({
  parentChildConfig,
  rules,
  summaryIndexSetting,
  currentDocForm: _currentDocForm,
  isActive,
  isInUpload,
  isNotUploadInEmptyDataset,
  onDocFormChange,
  onChunkForContextChange,
  onParentDelimiterChange,
  onParentMaxLengthChange,
  onChildDelimiterChange,
  onChildMaxLengthChange,
  onRuleToggle,
  onSummaryIndexSettingChange,
  onPreview,
  onReset,
  showSummaryIndexSetting,
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
      title={t('stepTwo.parentChild', { ns: 'datasetCreation' })}
      icon={<ParentChildChunk className="h-[20px] w-[20px]" />}
      effectImg={BlueEffect.src}
      className="text-util-colors-blue-light-blue-light-500"
      activeHeaderClassName="bg-dataset-option-card-blue-gradient"
      description={t('stepTwo.parentChildTip', { ns: 'datasetCreation' })}
      isActive={isActive}
      onSwitched={() => onDocFormChange(ChunkingMode.parentChild)}
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
      <div className="flex flex-col gap-4">
        {/* Parent chunk for context */}
        <div>
          <div className="flex items-center gap-x-2">
            <div className="inline-flex shrink-0">
              <TextLabel>{t('stepTwo.parentChunkForContext', { ns: 'datasetCreation' })}</TextLabel>
            </div>
            <Divider className="grow" bgStyle="gradient" />
          </div>
          <RadioCard
            className="mt-1"
            icon={<Image src={Note} alt="" />}
            title={t('stepTwo.paragraph', { ns: 'datasetCreation' })}
            description={t('stepTwo.paragraphTip', { ns: 'datasetCreation' })}
            isChosen={parentChildConfig.chunkForContext === 'paragraph'}
            onChosen={() => onChunkForContextChange('paragraph')}
            chosenConfig={(
              <div className="flex gap-3">
                <DelimiterInput
                  value={parentChildConfig.parent.delimiter}
                  tooltip={t('stepTwo.parentChildDelimiterTip', { ns: 'datasetCreation' })!}
                  onChange={e => onParentDelimiterChange(e.target.value)}
                />
                <MaxLengthInput
                  unit="characters"
                  value={parentChildConfig.parent.maxLength}
                  onChange={onParentMaxLengthChange}
                />
              </div>
            )}
          />
          <RadioCard
            className="mt-2"
            icon={<Image src={FileList} alt="" />}
            title={t('stepTwo.fullDoc', { ns: 'datasetCreation' })}
            description={t('stepTwo.fullDocTip', { ns: 'datasetCreation' })}
            onChosen={() => onChunkForContextChange('full-doc')}
            isChosen={parentChildConfig.chunkForContext === 'full-doc'}
          />
        </div>

        {/* Child chunk for retrieval */}
        <div>
          <div className="flex items-center gap-x-2">
            <div className="inline-flex shrink-0">
              <TextLabel>{t('stepTwo.childChunkForRetrieval', { ns: 'datasetCreation' })}</TextLabel>
            </div>
            <Divider className="grow" bgStyle="gradient" />
          </div>
          <div className="mt-1 flex gap-3">
            <DelimiterInput
              value={parentChildConfig.child.delimiter}
              tooltip={t('stepTwo.parentChildChunkDelimiterTip', { ns: 'datasetCreation' })!}
              onChange={e => onChildDelimiterChange(e.target.value)}
            />
            <MaxLengthInput
              unit="characters"
              value={parentChildConfig.child.maxLength}
              onChange={onChildMaxLengthChange}
            />
          </div>
        </div>

        {/* Rules */}
        <div>
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
          </div>
        </div>
      </div>
    </OptionCard>
  )
}
