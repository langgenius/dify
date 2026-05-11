'use client'
import type { FC } from 'react'
import { Switch } from '@langgenius/dify-ui/switch'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useContext } from 'use-context-selector'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { Microphone01 } from '@/app/components/base/icons/src/vender/features'
import { Infotip } from '@/app/components/base/infotip'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import ConfigContext from '@/context/debug-configuration'

const ConfigAudio: FC = () => {
  const { t } = useTranslation()
  const file = useFeatures(s => s.features.file)
  const featuresStore = useFeaturesStore()
  const { isShowAudioConfig, readonly } = useContext(ConfigContext)

  const isAudioEnabled = file?.allowed_file_types?.includes(SupportUploadFileTypes.audio) ?? false

  const handleChange = useCallback((value: boolean) => {
    const {
      features,
      setFeatures,
    } = featuresStore!.getState()

    const newFeatures = produce(features, (draft) => {
      if (value) {
        draft.file!.allowed_file_types = Array.from(new Set([
          ...(draft.file?.allowed_file_types || []),
          SupportUploadFileTypes.audio,
        ]))
      }
      else {
        draft.file!.allowed_file_types = draft.file!.allowed_file_types?.filter(
          type => type !== SupportUploadFileTypes.audio,
        )
      }
      if (draft.file)
        draft.file.enabled = (draft.file.allowed_file_types?.length ?? 0) > 0
    })
    setFeatures(newFeatures)
  }, [featuresStore])

  if (!isShowAudioConfig || (readonly && !isAudioEnabled))
    return null

  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border-t-[0.5px] border-l-[0.5px] bg-background-section-burn p-2">
      <div className="shrink-0 p-1">
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-600 p-1 shadow-xs">
          <Microphone01 className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      </div>
      <div className="flex grow items-center">
        <div className="mr-1 system-sm-semibold text-text-secondary">{t('feature.audioUpload.title', { ns: 'appDebug' })}</div>
        <Infotip
          aria-label={t('feature.audioUpload.description', { ns: 'appDebug' })}
          popupClassName="w-[180px]"
        >
          {t('feature.audioUpload.description', { ns: 'appDebug' })}
        </Infotip>
      </div>
      {!readonly && (
        <div className="flex shrink-0 items-center">
          <div className="mr-3 ml-1 h-3.5 w-px bg-divider-subtle"></div>
          <Switch
            checked={isAudioEnabled}
            onCheckedChange={handleChange}
            size="md"
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(ConfigAudio)
