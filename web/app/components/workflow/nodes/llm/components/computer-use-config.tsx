'use client'
import type { FC } from 'react'
import type { ToolSetting } from '../types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import FieldCollapse from '@/app/components/workflow/nodes/_base/components/collapse/field-collapse'
import Split from '@/app/components/workflow/nodes/_base/components/split'
import ReferenceToolConfig from './reference-tool-config'

const i18nPrefix = 'nodes.llm.computerUse'

type Props = {
  readonly: boolean
  enabled: boolean
  onChange: (enabled: boolean) => void
  nodeId: string
  toolSettings?: ToolSetting[]
  promptTemplateKey: string
}

const ComputerUseConfig: FC<Props> = ({
  readonly,
  enabled,
  onChange,
  nodeId,
  toolSettings,
  promptTemplateKey,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <Split />
      <FieldCollapse
        title={(
          <div className="flex items-center gap-1">
            {t(`${i18nPrefix}.title`, { ns: 'workflow' })}
            <Tooltip
              popupContent={t(`${i18nPrefix}.tooltip`, { ns: 'workflow' })}
              triggerClassName="h-4 w-4"
            />
          </div>
        )}
        noXSpacing
        operations={(
          <div>
            <Switch
              size="md"
              disabled={readonly}
              defaultValue={enabled}
              onChange={onChange}
            />
          </div>
        )}
      >
        <div className="mt-1 flex flex-col gap-1 p-1">
          <div className="flex h-6 items-center gap-1">
            <div className="system-xs-medium text-text-tertiary">
              {t(`${i18nPrefix}.referenceTools`, { ns: 'workflow' })}
            </div>
          </div>
          <ReferenceToolConfig
            readonly={readonly}
            enabled={enabled}
            nodeId={nodeId}
            toolSettings={toolSettings}
            promptTemplateKey={promptTemplateKey}
          />
        </div>
      </FieldCollapse>
      <Split />
    </div>
  )
}

export default React.memo(ComputerUseConfig)
