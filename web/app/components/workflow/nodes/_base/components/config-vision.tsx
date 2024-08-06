'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import ResolutionPicker from '@/app/components/workflow/nodes/llm/components/resolution-picker'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'
import type { VisionSetting } from '@/app/components/workflow/types'
import type { Resolution } from '@/types/app'
const i18nPrefix = 'workflow.nodes.llm'

type Props = {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  config: VisionSetting
  onConfigChange: (config: VisionSetting) => void
}

const ConfigVision: FC<Props> = ({
  enabled,
  onEnabledChange,
  config,
  onConfigChange,
}) => {
  const { t } = useTranslation()

  const handleVisionResolutionChange = useCallback((resolution: Resolution) => {
    const newConfig = produce(config, (draft) => {
      draft.resolution = resolution
    })
    onConfigChange(newConfig)
  }, [config, onConfigChange])

  return (
    <Field
      title={t(`${i18nPrefix}.vision`)}
      tooltip={t('appDebug.vision.description')!}
      operations={
        <Switch size='md' defaultValue={enabled} onChange={onEnabledChange} />
      }
    >
      {enabled
        ? (
          <ResolutionPicker
            value={config.resolution}
            onChange={handleVisionResolutionChange}
          />
        )
        : null}

    </Field>
  )
}
export default React.memo(ConfigVision)
