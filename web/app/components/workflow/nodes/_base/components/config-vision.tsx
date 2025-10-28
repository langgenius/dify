'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { produce } from 'immer'
import VarReferencePicker from './variable/var-reference-picker'
import ResolutionPicker from '@/app/components/workflow/nodes/llm/components/resolution-picker'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import Switch from '@/app/components/base/switch'
import { type ValueSelector, type Var, VarType, type VisionSetting } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'
import Tooltip from '@/app/components/base/tooltip'
const i18nPrefix = 'workflow.nodes.llm'

type Props = {
  isVisionModel: boolean
  readOnly: boolean
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  nodeId: string
  config?: VisionSetting
  onConfigChange: (config: VisionSetting) => void
}

const ConfigVision: FC<Props> = ({
  isVisionModel,
  readOnly,
  enabled,
  onEnabledChange,
  nodeId,
  config = {
    detail: Resolution.high,
    variable_selector: [],
  },
  onConfigChange,
}) => {
  const { t } = useTranslation()

  const filterVar = useCallback((payload: Var) => {
    return [VarType.file, VarType.arrayFile].includes(payload.type)
  }, [])
  const handleVisionResolutionChange = useCallback((resolution: Resolution) => {
    const newConfig = produce(config, (draft) => {
      draft.detail = resolution
    })
    onConfigChange(newConfig)
  }, [config, onConfigChange])

  const handleVarSelectorChange = useCallback((valueSelector: ValueSelector | string) => {
    const newConfig = produce(config, (draft) => {
      draft.variable_selector = valueSelector as ValueSelector
    })
    onConfigChange(newConfig)
  }, [config, onConfigChange])

  return (
    <Field
      title={t(`${i18nPrefix}.vision`)}
      tooltip={t('appDebug.vision.description')!}
      operations={
        <Tooltip
          popupContent={t('appDebug.vision.onlySupportVisionModelTip')!}
          disabled={isVisionModel}
        >
          <Switch disabled={readOnly || !isVisionModel} size='md' defaultValue={!isVisionModel ? false : enabled} onChange={onEnabledChange} />
        </Tooltip>
      }
    >
      {(enabled && isVisionModel)
        ? (
          <div>
            <VarReferencePicker
              className='mb-4'
              filterVar={filterVar}
              nodeId={nodeId}
              value={config.variable_selector || []}
              onChange={handleVarSelectorChange}
              readonly={readOnly}
            />
            <ResolutionPicker
              value={config.detail}
              onChange={handleVisionResolutionChange}
            />
          </div>
        )
        : null}

    </Field>
  )
}
export default React.memo(ConfigVision)
