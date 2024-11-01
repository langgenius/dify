import type { FC } from 'react'
import useSWR from 'swr'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import VarReferencePicker from '../_base/components/variable/var-reference-picker'
import OutputVars, { VarItem } from '../_base/components/output-vars'
import Split from '../_base/components/split'
import { useNodeHelpLink } from '../_base/hooks/use-node-help-link'
import useConfig from './use-config'
import type { MediaExtractorNodeType } from './types'
import { fetchSupportFileTypes } from '@/service/datasets'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import { BlockEnum, type NodePanelProps } from '@/app/components/workflow/types'
import I18n from '@/context/i18n'
import { LanguagesSupported } from '@/i18n/language'
import Tooltip from '@/app/components/base/tooltip'
import RadioGroup from '@/app/components/base/radio-group'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import {
  IsExtractAudio,
  IsExtractAudioWordTimestamps,
  IsExtractVideo,
  SpliceMode,
} from '@/types/app'
import ParamItem from '@/app/components/base/param-item'
import s from '@/app/components/datasets/documents/style.module.css'

const i18nPrefix = 'workflow.nodes.mediaExtractor'

const Panel: FC<NodePanelProps<MediaExtractorNodeType>> = ({ id, data }) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const link = useNodeHelpLink(BlockEnum.MediaExtractor)
  const { data: supportFileTypesResponse } = useSWR({ url: '/files/support-type?file_class=media' }, fetchSupportFileTypes)
  const supportTypes = supportFileTypesResponse?.allowed_extensions || []
  const supportTypesShowNames = (() => {
    const extensionMap: { [key: string]: string } = {
      mp4: 'mp4',
      mpga: 'mpga',
      mpeg: 'mpeg',
      mov: 'mov',
      mp3: 'mp3',
      m4a: 'm4a',
      wav: 'wav',
      webm: 'webm',
      amr: 'amr',
    }

    return [...supportTypes]
      .map(item => extensionMap[item] || item) // map to standardized extension
      .map(item => item.toLowerCase()) // convert to lower case
      .filter((item, index, self) => self.indexOf(item) === index) // remove duplicates
      .join(locale !== LanguagesSupported[1] ? ', ' : '、 ')
  })()
  const { readOnly, inputs, handleVarChanges, filterVar, handleMediaConfigChange } = useConfig(id, data)
  return (
    <div className='mt-2'>
      <div className='px-4 pb-4 space-y-4'>
        <Field title={t(`${i18nPrefix}.inputVar`)}>
          <>
            <VarReferencePicker
              readonly={readOnly}
              nodeId={id}
              isShowNodeName
              value={inputs.variable_selector || []}
              onChange={handleVarChanges}
              filterVar={filterVar}
              typePlaceHolder='File'
            />
            <div className='mt-1 py-0.5 text-text-tertiary body-xs-regular'>
              {t(`${i18nPrefix}.supportFileTypes`, { types: supportTypesShowNames })}
              <a className='text-text-accent' href={link} target='_blank'>{t(`${i18nPrefix}.learnMore`)}</a>
            </div>
          </>
        </Field>
      </div>
      <Split />
      <div className='px-4 pt-4 pb-4 space-y-4'>
        <div>
          <div className='mb-2 flex items-center space-x-1'>
            <div
              className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.extractAudio')}</div>
            <Tooltip popupContent={<div className='w-[180px]'>
              {t('appDebug.vision.visionSettings.extractAudiotip').split('\n').map(item => (
                <div key={item}>{item}</div>
              ))}</div>}>
              <HelpCircle className='w-[14px] h-[14px] text-gray-400'/>
            </Tooltip>
          </div>
          <RadioGroup
            className='space-x-3'
            options={[
              {
                label: t('appDebug.vision.visionSettings.InextractAudio'),
                value: IsExtractAudio.enabled,
              },
              {
                label: t('appDebug.vision.visionSettings.ExextractAudio'),
                value: IsExtractAudio.disabled,
              },
            ]}
            value={inputs.variable_config?.extract_audio ?? IsExtractAudio.disabled}
            onChange={val => handleMediaConfigChange({
              ...inputs.variable_config,
              extract_audio: val,
            })}
          />
        </div>
        {inputs.variable_config?.extract_audio === IsExtractAudio.enabled && (
          <div>
            <div className='mb-2 flex items-center space-x-1'>
              <div
                className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.extractAudioWordTimestamps')}</div>
              <Tooltip popupContent={<div className='w-[180px]'>
                {t('appDebug.vision.visionSettings.extractAudioWordTimestampstip').split('\n').map(item => (
                  <div key={item}>{item}</div>
                ))}
              </div>}>
                <HelpCircle className='w-[14px] h-[14px] text-gray-400'/>
              </Tooltip>
            </div>
            <RadioGroup
              className='space-x-3'
              options={[
                {
                  label: t('appDebug.vision.visionSettings.InextractAudioWordTimestamps'),
                  value: IsExtractAudioWordTimestamps.enabled,
                },
                {
                  label: t('appDebug.vision.visionSettings.ExextractAudioWordTimestamps'),
                  value: IsExtractAudioWordTimestamps.disabled,
                },
              ]}
              value={inputs.variable_config?.word_timestamps ?? IsExtractAudioWordTimestamps.disabled }
              onChange={val => handleMediaConfigChange({
                ...inputs.variable_config,
                word_timestamps: val,
              })}
            />
          </div>
        )}
        <div>
          <div className='mb-2 flex items-center space-x-1'>
            <div
              className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.extractVideo')}</div>
            <Tooltip popupContent={<div className='w-[180px]'>
              {t('appDebug.vision.visionSettings.extractVideotip').split('\n').map(item => (
                <div key={item}>{item}</div>
              ))}
            </div>}>
              <HelpCircle className='w-[14px] h-[14px] text-gray-400'/>
            </Tooltip>
          </div>
          <RadioGroup
            className='space-x-3'
            options={[
              {
                label: t('appDebug.vision.visionSettings.InextractVideo'),
                value: IsExtractVideo.enabled,
              },
              {
                label: t('appDebug.vision.visionSettings.ExextractVideo'),
                value: IsExtractVideo.disabled,
              },
            ]}
            value={inputs.variable_config?.extract_video ?? IsExtractVideo.disabled}
            onChange={val => handleMediaConfigChange({
              ...inputs.variable_config,
              extract_video: val,
            })}
          />
        </div>
        {inputs.variable_config?.extract_video === IsExtractVideo.enabled
          ? (
            <>
              <div>
                <div className='mb-2 flex items-center space-x-1'>
                  <div
                    className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.spliceMode')}</div>
                  <Tooltip popupContent={<div className='w-[180px]'>
                    {t('appDebug.vision.visionSettings.spliceModetip').split('\n').map(item => (
                      <div key={item}>{item}</div>
                    ))}
                  </div>}>
                    <HelpCircle className='w-[14px] h-[14px] text-gray-400'/>
                  </Tooltip>
                </div>
                <RadioGroup
                  className='space-x-3'
                  options={[
                    {
                      label: t('appDebug.vision.visionSettings.Vertical'),
                      value: SpliceMode.vertical,
                    },
                    {
                      label: t('appDebug.vision.visionSettings.Horizontal'),
                      value: SpliceMode.horizontal,
                    },
                    {
                      label: t('appDebug.vision.visionSettings.Images'),
                      value: SpliceMode.images,
                    },
                  ]}
                  value={inputs.variable_config?.splice_mode ?? SpliceMode.horizontal}
                  onChange={val => handleMediaConfigChange({
                    ...inputs.variable_config,
                    splice_mode: val,
                  })}
                />
              </div>
              <div>
                <ParamItem
                  id='MaxCollectFrames'
                  className=''
                  name={t('appDebug.vision.visionSettings.MaxCollectFrames')}
                  noTooltip
                  {...{
                    default: 20,
                    step: 1,
                    min: 3,
                    max: 100,
                  }}
                  enable={true}
                  value={inputs.variable_config?.max_collect_frames ?? 20}
                  onChange={(_key: string, value: number) => {
                    if (!value)
                      return

                    handleMediaConfigChange({
                      ...inputs.variable_config,
                      max_collect_frames: value,
                    })
                  }}
                />
                <ParamItem
                  id='blurThreshold'
                  className=''
                  name={t('appDebug.vision.visionSettings.blurThreshold')}
                  noTooltip
                  {...{
                    default: 800,
                    step: 50,
                    min: 500,
                    max: 2000,
                  }}
                  enable={true}
                  value={inputs.variable_config?.blur_threshold ?? 800}
                  onChange={(_key: string, value: number) => {
                    if (!value)
                      return

                    handleMediaConfigChange({
                      ...inputs.variable_config,
                      blur_threshold: value,
                    })
                  }}
                />
                <ParamItem
                  id='similarityThreshold'
                  className=''
                  name={t('appDebug.vision.visionSettings.similarityThreshold')}
                  noTooltip
                  {...{
                    default: 0.7,
                    step: 0.1,
                    min: 0.1,
                    max: 1.0,
                  }}
                  enable={true}
                  value={inputs.variable_config?.similarity_threshold ?? 0.7}
                  onChange={(_key: string, value: number) => {
                    if (!value)
                      return

                    handleMediaConfigChange({
                      ...inputs.variable_config,
                      similarity_threshold: value,
                    })
                  }}
                />
              </div>
            </>
          )
          : (<><p className={s.desc}>{t('appDebug.vision.visionSettings.VideoTips')}</p></>)}
      </div>
      <Split />
      <div className='px-4 pt-4 pb-2'>
        <OutputVars>
          <>
            <VarItem
              name='text'
              type={'string'}
              description={t(`${i18nPrefix}.outputVars.text`)}
            />
            <VarItem
              name='images'
              type={'array[file]'}
              description={t(`${i18nPrefix}.outputVars.images`)}
            />
          </>
        </OutputVars>
      </div>
    </div>
  )
}

export default React.memo(Panel)
