'use client'

import produce from 'immer'
import React, { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnFeaturesChange } from '../../types'
import {
  useFeatures,
  useFeaturesStore,
} from '../../hooks'
import RadioGroup from './radio-group'
import { IsExtractAudio, IsExtractVideo, TransferMethod } from '@/types/app'
import ParamItem from '@/app/components/base/param-item'
import Tooltip from '@/app/components/base/tooltip'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'

const MIN = 1
const MAX = 6
type ParamConfigContentProps = {
  onChange?: OnFeaturesChange
}
const ParamConfigContent = ({
  onChange,
}: ParamConfigContentProps) => {
  const { t } = useTranslation()
  const featuresStore = useFeaturesStore()
  const file = useFeatures(s => s.features.file)

  const transferMethod = useMemo(() => {
    if (!file?.image?.transfer_methods || file?.image.transfer_methods.length === 2)
      return TransferMethod.all

    return file.image.transfer_methods[0]
  }, [file?.image?.transfer_methods])

  const handleTransferMethodsChange = useCallback((value: TransferMethod) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.image) {
        if (value === TransferMethod.all)
          draft.file.image.transfer_methods = [TransferMethod.remote_url, TransferMethod.local_file]
        else
          draft.file.image.transfer_methods = [value]
      }
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleLimitsChange = useCallback((_key: string, value: number) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.image)
        draft.file.image.number_limits = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleExtractAudioChange = useCallback((value: IsExtractAudio) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.video)
        draft.file.video.extract_audio = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleExtractVideoChange = useCallback((value: IsExtractVideo) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.video)
        draft.file.video.extract_video = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleMaxCollectFramesChange = useCallback((_key: string, value: number) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.video)
        draft.file.video.max_collect_frames = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handleblurThresholdChange = useCallback((_key: string, value: number) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.video)
        draft.file.video.blur_threshold = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  const handlesimilarityThresholdChange = useCallback((_key: string, value: number) => {
    if (!value)
      return

    const {
      features,
      setFeatures,
    } = featuresStore!.getState()
    const newFeatures = produce(features, (draft) => {
      if (draft.file?.video)
        draft.file.video.similarity_threshold = value
    })
    setFeatures(newFeatures)
    if (onChange)
      onChange(newFeatures)
  }, [featuresStore, onChange])

  return (
    <div>
      <div>
        <div className='leading-6 text-base font-semibold text-gray-800'>{t('common.operation.settings')}</div>
        <div className='pt-3 space-y-6'>
          <div>
            <div className='mb-2 leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.uploadMethod')}</div>
            <RadioGroup
              className='space-x-3'
              options={[
                {
                  label: t('appDebug.vision.visionSettings.both'),
                  value: TransferMethod.all,
                },
                {
                  label: t('appDebug.vision.visionSettings.localUpload'),
                  value: TransferMethod.local_file,
                },
                {
                  label: t('appDebug.vision.visionSettings.url'),
                  value: TransferMethod.remote_url,
                },
              ]}
              value={transferMethod}
              onChange={handleTransferMethodsChange}
            />
          </div>
          <div>
            <ParamItem
              id='upload_limit'
              className=''
              name={t('appDebug.vision.visionSettings.uploadLimit')}
              noTooltip
              {...{
                default: 2,
                step: 1,
                min: MIN,
                max: MAX,
              }}
              value={file?.image?.number_limits || 3}
              enable={true}
              onChange={handleLimitsChange}
            />
          </div>
        </div>
        <div className="page-break-before">{t('appDebug.vision.visionSettings.video_extraction')}</div>
        <div>
          <div className='mb-2 flex items-center space-x-1'>
            <div className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.extractAudio')}</div>
            <Tooltip htmlContent={<div className='w-[180px]'>
              {t('appDebug.vision.visionSettings.extractAudiotip').split('\n').map(item => (
                <div key={item}>{item}</div>
              ))}
            </div>} selector='config-extractaudio-tooltip'>
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
                value: IsExtractAudio.diabled,
              },
            ]}
            value={file?.video?.extract_audio || 'enabled'}
            onChange={handleExtractAudioChange}
          />
        </div>
        <div>
          <div className='mb-2 flex items-center space-x-1'>
            <div className='leading-[18px] text-[13px] font-semibold text-gray-800'>{t('appDebug.vision.visionSettings.extractVideo')}</div>
            <Tooltip htmlContent={<div className='w-[180px]'>
              {t('appDebug.vision.visionSettings.extractVideotip').split('\n').map(item => (
                <div key={item}>{item}</div>
              ))}
            </div>} selector='config-extractvideo-tooltip'>
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
                value: IsExtractVideo.diabled,
              },
            ]}
            value={file?.video?.extract_video || 'enabled'}
            onChange={handleExtractVideoChange}
          />
        </div>
        { file?.video?.extract_video === IsExtractVideo.enabled && (
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
              value={file?.video?.max_collect_frames || 20}
              enable={true}
              onChange={handleMaxCollectFramesChange}
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
              value={file?.video?.blur_threshold || 800}
              enable={true}
              onChange={handleblurThresholdChange}
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
              value={file?.video?.similarity_threshold || 0.7}
              enable={true}
              onChange={handlesimilarityThresholdChange}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(ParamConfigContent)
