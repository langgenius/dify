import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Indicator from '@/app/components/header/indicator'

export type EntryNodeStatus = 'enabled' | 'disabled'

type EntryNodeContainerProps = {
  children: ReactNode
  status?: EntryNodeStatus
  customLabel?: string
  showIndicator?: boolean
  nodeType?: 'start' | 'trigger'
}

const EntryNodeContainer: FC<EntryNodeContainerProps> = ({
  children,
  status = 'enabled',
  customLabel,
  showIndicator = true,
  nodeType = 'trigger',
}) => {
  const { t } = useTranslation()

  const statusConfig = useMemo(() => {
    const isDisabled = status === 'disabled'

    const translationKey = nodeType === 'start' ? 'entryNodeStatus' : 'triggerStatus'

    return {
      label: customLabel || (isDisabled ? t(`workflow.${translationKey}.disabled`) : t(`workflow.${translationKey}.enabled`)),
      indicatorColor: isDisabled ? 'gray' : 'green',
    }
  }, [status, customLabel, nodeType, t])

  return (
    <div className="w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-0 pb-0 pt-0.5">
      <div className="mb-0.5 flex items-center px-1.5 pt-0.5">
        {showIndicator && (
          <Indicator
            color={statusConfig.indicatorColor as 'green' | 'gray'}
            className="mr-0.5"
          />
        )}
        <span className={`text-2xs font-semibold uppercase text-text-tertiary ${!showIndicator ? 'ml-0.5' : ''}`}>
          {statusConfig.label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default EntryNodeContainer
