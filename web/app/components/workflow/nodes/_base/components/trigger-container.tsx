import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'

export type TriggerStatus = 'enabled' | 'disabled'

type TriggerContainerProps = {
  children: ReactNode
  status?: TriggerStatus
  customLabel?: string
}

const TriggerContainer: FC<TriggerContainerProps> = ({
  children,
  status = 'enabled',
  customLabel,
}) => {
  const { t } = useTranslation()

  const statusConfig = useMemo(() => {
    const isDisabled = status === 'disabled'

    return {
      label: customLabel || (isDisabled ? t('workflow.triggerStatus.disabled') : t('workflow.triggerStatus.enabled')),
      dotColor: isDisabled ? 'bg-text-tertiary' : 'bg-green-500',
    }
  }, [status, customLabel, t])

  return (
    <div className="w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-px pb-px pt-0.5">
      <div className="mb-0.5 flex items-center px-2 pt-1">
        <div className={cn('mr-1 h-2 w-2 rounded-sm', statusConfig.dotColor)} />
        <span className="system-2xs-medium-uppercase text-text-tertiary">
          {statusConfig.label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default TriggerContainer
