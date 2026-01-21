'use client'
import type { FC } from 'react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '@/app/components/base/switch'
import Field from '@/app/components/workflow/nodes/_base/components/field'

const i18nPrefix = 'nodes.llm.computerUse'

type Props = {
  readonly: boolean
  enabled: boolean
  onChange: (enabled: boolean) => void
}

const ComputerUseConfig: FC<Props> = ({
  readonly,
  enabled,
  onChange,
}) => {
  const { t } = useTranslation()

  return (
    <Field
      title={t(`${i18nPrefix}.title`, { ns: 'workflow' })}
      tooltip={t(`${i18nPrefix}.tooltip`, { ns: 'workflow' })!}
      operations={(
        <Switch
          size="md"
          disabled={readonly}
          defaultValue={enabled}
          onChange={onChange}
        />
      )}
    />
  )
}

export default React.memo(ComputerUseConfig)
