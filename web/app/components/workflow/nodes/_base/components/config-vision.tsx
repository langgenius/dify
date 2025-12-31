'use client'
import type { FC } from 'react'
import type { ValueSelector, Var, VisionSetting } from '@/app/components/workflow/types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import ResolutionPicker from '@/app/components/workflow/nodes/llm/components/resolution-picker'
import { VarType } from '@/app/components/workflow/types'
import { Resolution } from '@/types/app'
import VarReferencePicker from './variable/var-reference-picker'

const i18nPrefix = 'nodes.llm'

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
      title={t(`${i18nPrefix}.vision`, { ns: 'workflow' })}
      tooltip={t('vision.description', { ns: 'appDebug' })!}
      operations={(
        <Tooltip
          popupContent={t('vision.onlySupportVisionModelTip', { ns: 'appDebug' })!}
          disabled={isVisionModel}
        >
          <Switch disabled={readOnly || !isVisionModel} size="md" defaultValue={!isVisionModel ? false : enabled} onChange={onEnabledChange} />
        </Tooltip>
      )}
    >
      {(enabled && isVisionModel)
        ? (
            <div>
              <VarReferencePicker
                className="mb-4"
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
