import type { FC } from 'react'
import type { HumanInputNodeType } from './types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Field from '@/app/components/workflow/nodes/_base/components/field'
import useConfig from './use-config'

const i18nPrefix = 'workflow.nodes.humanInput'

const Panel: FC<NodePanelProps<HumanInputNodeType>> = ({
  id,
  data,
}) => {
  const { t } = useTranslation()

  const {
    readOnly,
    inputs,
    handlePauseReasonChange,
  } = useConfig(id, data)

  return (
    <div className="mt-2">
      <div className="space-y-4 px-4 pb-4">
        <Field
          title={t(`${i18nPrefix}.pauseReason`)}
          tooltip={t(`${i18nPrefix}.description`)}
        >
          <div className="space-y-2">
            <Input
              value={inputs.pause_reason || ''}
              onChange={(e) => {
                handlePauseReasonChange(e.target.value)
              }}
              placeholder={t(`${i18nPrefix}.pauseReasonPlaceholder`)}
              disabled={readOnly}
            />
            {!inputs.pause_reason && (
              <div className="text-xs text-red-500">
                {t(`${i18nPrefix}.pauseReasonRequired`)}
              </div>
            )}
          </div>
        </Field>
      </div>
    </div>
  )
}

export default React.memo(Panel)
