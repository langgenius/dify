'use client'
import type { FC } from 'react'
import { noop } from 'es-toolkit/function'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
// import { Resolution } from '@/types/app'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { Vision } from '@/app/components/base/icons/src/vender/features'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
// import OptionCard from '@/app/components/workflow/nodes/_base/components/option-card'
import ConfigContext from '@/context/debug-configuration'
import { Resolution } from '@/types/app'
import { cn } from '@/utils/classnames'
import ParamConfig from './param-config'

const ConfigVision: FC = () => {
  const { t } = useTranslation()
  const { isShowVisionConfig, isAllowVideoUpload, readonly } = useContext(ConfigContext)
  const file = useFeatures(s => s.features.file)
  const featuresStore = useFeaturesStore()

  const isImageEnabled = file?.allowed_file_types?.includes(SupportUploadFileTypes.image) ?? false

  const handleChange = useCallback((value: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      if (value) {
        draft.file!.allowed_file_types = Array.from(new Set([
          ...(draft.file?.allowed_file_types || []),
          SupportUploadFileTypes.image,
          ...(isAllowVideoUpload ? [SupportUploadFileTypes.video] : []),
        ]))
      }
      else {
        draft.file!.allowed_file_types = draft.file!.allowed_file_types?.filter(
          type => type !== SupportUploadFileTypes.image && (isAllowVideoUpload ? type !== SupportUploadFileTypes.video : true),
        )
      }

      if (draft.file) {
        draft.file.enabled = (draft.file.allowed_file_types?.length ?? 0) > 0
        draft.file.image = {
          ...draft.file.image,
          enabled: value,
        }
      }
    })
    setFeatures(newFeatures)
  }, [featuresStore, isAllowVideoUpload])

  if (!isShowVisionConfig || (readonly && !isImageEnabled))
    return null

  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border-l-[0.5px] border-t-[0.5px] border-effects-highlight bg-background-section-burn p-2">
      <div className="shrink-0 p-1">
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-indigo-indigo-600 p-1 shadow-xs">
          <Vision className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      </div>
      <div className="flex grow items-center">
        <div className="system-sm-semibold mr-1 text-text-secondary">{t('vision.name', { ns: 'appDebug' })}</div>
        <Tooltip
          popupContent={(
            <div className="w-[180px]">
              {t('vision.description', { ns: 'appDebug' })}
            </div>
          )}
        />
      </div>
      <div className="flex shrink-0 items-center">
        {readonly
          ? (
              <>
                <div className="mr-2 flex items-center gap-0.5">
                  <div className="system-xs-medium-uppercase text-text-tertiary">{t('vision.visionSettings.resolution', { ns: 'appDebug' })}</div>
                  <Tooltip
                    popupContent={(
                      <div className="w-[180px]">
                        {t('vision.visionSettings.resolutionTooltip', { ns: 'appDebug' }).split('\n').map(item => (
                          <div key={item}>{item}</div>
                        ))}
                      </div>
                    )}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <OptionCard
                    title={t('vision.visionSettings.high', { ns: 'appDebug' })}
                    selected={file?.image?.detail === Resolution.high}
                    onSelect={noop}
                    className={cn(
                      'cursor-not-allowed rounded-lg px-3  hover:shadow-none',
                      file?.image?.detail !== Resolution.high && 'hover:border-components-option-card-option-border',
                    )}
                  />
                  <OptionCard
                    title={t('vision.visionSettings.low', { ns: 'appDebug' })}
                    selected={file?.image?.detail === Resolution.low}
                    onSelect={noop}
                    className={cn(
                      'cursor-not-allowed rounded-lg px-3  hover:shadow-none',
                      file?.image?.detail !== Resolution.low && 'hover:border-components-option-card-option-border',
                    )}
                  />
                </div>
              </>
            )
          : (
              <>
                <ParamConfig />
                <div className="ml-1 mr-3 h-3.5 w-[1px] bg-divider-regular"></div>
                <Switch
                  defaultValue={isImageEnabled}
                  onChange={handleChange}
                  size="md"
                />
              </>
            )}

      </div>
    </div>
  )
}
export default React.memo(ConfigVision)
