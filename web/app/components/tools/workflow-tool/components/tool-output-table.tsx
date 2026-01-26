'use client'
import type { FC } from 'react'
import type { WorkflowToolProviderOutputParameter } from '@/app/components/tools/types'
import { RiErrorWarningLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'

type ToolOutputTableProps = {
  parameters: WorkflowToolProviderOutputParameter[]
  isReserved: (name: string) => boolean
}

type OutputRowProps = {
  item: WorkflowToolProviderOutputParameter
  isReserved: (name: string) => boolean
}

const OutputRow: FC<OutputRowProps> = ({ item, isReserved }) => {
  const { t } = useTranslation()
  const showDuplicateWarning = !item.reserved && isReserved(item.name)

  return (
    <tr className="border-b border-divider-regular last:border-0">
      <td className="max-w-[156px] p-2 pl-3">
        <div className="text-[13px] leading-[18px]">
          <div title={item.name} className="flex items-center">
            <span className="truncate font-medium text-text-primary">{item.name}</span>
            {item.reserved && (
              <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">
                {t('createTool.toolOutput.reserved', { ns: 'tools' })}
              </span>
            )}
            {showDuplicateWarning && (
              <Tooltip
                popupContent={(
                  <div className="w-[180px]">
                    {t('createTool.toolOutput.reservedParameterDuplicateTip', { ns: 'tools' })}
                  </div>
                )}
              >
                <RiErrorWarningLine className="h-3 w-3 text-text-warning-secondary" />
              </Tooltip>
            )}
          </div>
          <div className="text-text-tertiary">{item.type}</div>
        </div>
      </td>
      <td className="w-[236px] p-2 pl-3 text-text-tertiary">
        <span className="text-[13px] font-normal leading-[18px] text-text-secondary">
          {item.description}
        </span>
      </td>
    </tr>
  )
}

const ToolOutputTable: FC<ToolOutputTableProps> = ({ parameters, isReserved }) => {
  const { t } = useTranslation()

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
      <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
        <thead className="uppercase text-text-tertiary">
          <tr className="border-b border-divider-regular">
            <th className="w-[156px] p-2 pl-3 font-medium">
              {t('createTool.name', { ns: 'tools' })}
            </th>
            <th className="p-2 pl-3 font-medium">
              {t('createTool.toolOutput.description', { ns: 'tools' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {parameters.map(item => (
            <OutputRow
              key={item.name}
              item={item}
              isReserved={isReserved}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default React.memo(ToolOutputTable)
