import type { FC, ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export enum StartNodeTypeEnum {
  Start = 'start',
  Trigger = 'trigger',
}

type EntryNodeContainerProps = {
  children: ReactNode
  customLabel?: string
  nodeType?: StartNodeTypeEnum
}

const EntryNodeContainer: FC<EntryNodeContainerProps> = ({
  children,
  customLabel,
  nodeType = StartNodeTypeEnum.Trigger,
}) => {
  const { t } = useTranslation()

  const label = useMemo(() => {
    const translationKey = nodeType === StartNodeTypeEnum.Start ? 'entryNodeStatus' : 'triggerStatus'
    return customLabel || t(`${translationKey}.enabled`, { ns: 'workflow' })
  }, [customLabel, nodeType, t])

  return (
    <div className="w-fit min-w-[242px] rounded-2xl bg-workflow-block-wrapper-bg-1 px-0 pb-0 pt-0.5">
      <div className="mb-0.5 flex items-center px-2.5 pt-0.5">
        <span className="text-2xs font-semibold uppercase text-text-tertiary">
          {label}
        </span>
      </div>
      {children}
    </div>
  )
}

export default EntryNodeContainer
