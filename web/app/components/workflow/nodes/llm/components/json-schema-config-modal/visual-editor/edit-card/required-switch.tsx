import type { FC } from 'react'
import { Switch } from '@langgenius/dify-ui/switch'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type RequiredSwitchProps = {
  defaultValue: boolean
  toggleRequired: () => void
}

const RequiredSwitch: FC<RequiredSwitchProps> = ({
  defaultValue,
  toggleRequired,
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1 rounded-[5px] border border-divider-subtle bg-background-default-lighter px-1.5 py-1">
      <span className="system-2xs-medium-uppercase text-text-secondary">{t('nodes.llm.jsonSchema.required', { ns: 'workflow' })}</span>
      <Switch size="xs" checked={defaultValue} onCheckedChange={toggleRequired} />
    </div>
  )
}

export default React.memo(RequiredSwitch)
