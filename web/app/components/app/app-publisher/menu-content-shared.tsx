import type { FC, ReactNode } from 'react'
import type { SuggestedActionProps } from './suggested-action'
import type { I18nKeysByPrefix } from '@/types/i18n'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../base/ui/tooltip'
import SuggestedAction from './suggested-action'

type AccessModeLabel = I18nKeysByPrefix<'app', 'accessControlDialog.accessItems.'>

const ACCESS_MODE_MAP: Record<AccessMode, { label: AccessModeLabel, icon: string }> = {
  [AccessMode.ORGANIZATION]: {
    label: 'organization',
    icon: 'i-ri-building-line',
  },
  [AccessMode.SPECIFIC_GROUPS_MEMBERS]: {
    label: 'specific',
    icon: 'i-ri-lock-line',
  },
  [AccessMode.PUBLIC]: {
    label: 'anyone',
    icon: 'i-ri-global-line',
  },
  [AccessMode.EXTERNAL_MEMBERS]: {
    label: 'external',
    icon: 'i-ri-verified-badge-line',
  },
}

export const AccessModeDisplay: FC<{ mode?: AccessMode }> = ({ mode }) => {
  const { t } = useTranslation()

  if (!mode || !ACCESS_MODE_MAP[mode])
    return null

  const { icon, label } = ACCESS_MODE_MAP[mode]

  return (
    <>
      <span className={`${icon} h-4 w-4 shrink-0 text-text-secondary`} />
      <div className="grow truncate">
        <span className="text-text-secondary system-sm-medium">{t(`accessControlDialog.accessItems.${label}`, { ns: 'app' })}</span>
      </div>
    </>
  )
}

type SuggestedActionWithTooltipProps = SuggestedActionProps & {
  tooltip?: ReactNode
}

export const SuggestedActionWithTooltip = ({
  children,
  tooltip,
  ...props
}: SuggestedActionWithTooltipProps) => {
  const action = (
    <SuggestedAction {...props}>
      {children}
    </SuggestedAction>
  )

  if (!tooltip)
    return action

  return (
    <Tooltip>
      <TooltipTrigger render={action} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
