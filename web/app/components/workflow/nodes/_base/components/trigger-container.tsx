import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'

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
      indicatorColor: isDisabled ? 'gray' : 'green',
    }
  }, [status, customLabel, t])

  return (
    <div className="w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-0 pb-0 pt-0.5">
      <div className="mb-0.5 flex items-center px-1.5 pt-0.5">
        <Indicator
          color={statusConfig.indicatorColor as 'green' | 'gray'}
          className="ml-0.5 mr-0.5"
        />
        <span className="text-2xs font-semibold uppercase text-text-tertiary">
          {statusConfig.label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default TriggerContainer
