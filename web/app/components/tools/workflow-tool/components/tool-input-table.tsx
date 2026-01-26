'use client'
import type { FC } from 'react'
import type { WorkflowToolProviderParameter } from '@/app/components/tools/types'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import MethodSelector from '../method-selector'

type ToolInputTableProps = {
  parameters: WorkflowToolProviderParameter[]
  onParameterChange: (key: 'description' | 'form', value: string, index: number) => void
}

type ParameterRowProps = {
  item: WorkflowToolProviderParameter
  index: number
  onParameterChange: (key: 'description' | 'form', value: string, index: number) => void
}

const ParameterRow: FC<ParameterRowProps> = ({ item, index, onParameterChange }) => {
  const { t } = useTranslation()
  const isImageParameter = item.name === '__image'

  return (
    <tr className="border-b border-divider-regular last:border-0">
      <td className="max-w-[156px] p-2 pl-3">
        <div className="text-[13px] leading-[18px]">
          <div title={item.name} className="flex">
            <span className="truncate font-medium text-text-primary">{item.name}</span>
            {item.required && (
              <span className="shrink-0 pl-1 text-xs leading-[18px] text-[#ec4a0a]">
                {t('createTool.toolInput.required', { ns: 'tools' })}
              </span>
            )}
          </div>
          <div className="text-text-tertiary">{item.type}</div>
        </div>
      </td>
      <td>
        {isImageParameter
          ? (
              <div className={cn(
                'flex h-9 min-h-[56px] cursor-default items-center gap-1 bg-transparent px-3 py-2',
              )}
              >
                <div className="grow truncate text-[13px] leading-[18px] text-text-secondary">
                  {t('createTool.toolInput.methodParameter', { ns: 'tools' })}
                </div>
              </div>
            )
          : (
              <MethodSelector
                value={item.form}
                onChange={value => onParameterChange('form', value, index)}
              />
            )}
      </td>
      <td className="w-[236px] p-2 pl-3 text-text-tertiary">
        <input
          type="text"
          className="w-full appearance-none bg-transparent text-[13px] font-normal leading-[18px] text-text-secondary caret-primary-600 outline-none placeholder:text-text-quaternary"
          placeholder={t('createTool.toolInput.descriptionPlaceholder', { ns: 'tools' })!}
          value={item.description}
          onChange={e => onParameterChange('description', e.target.value, index)}
        />
      </td>
    </tr>
  )
}

const ToolInputTable: FC<ToolInputTableProps> = ({ parameters, onParameterChange }) => {
  const { t } = useTranslation()

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
      <table className="w-full text-xs font-normal leading-[18px] text-text-secondary">
        <thead className="uppercase text-text-tertiary">
          <tr className="border-b border-divider-regular">
            <th className="w-[156px] p-2 pl-3 font-medium">
              {t('createTool.toolInput.name', { ns: 'tools' })}
            </th>
            <th className="w-[102px] p-2 pl-3 font-medium">
              {t('createTool.toolInput.method', { ns: 'tools' })}
            </th>
            <th className="p-2 pl-3 font-medium">
              {t('createTool.toolInput.description', { ns: 'tools' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {parameters.map((item, index) => (
            <ParameterRow
              key={item.name}
              item={item}
              index={index}
              onParameterChange={onParameterChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default React.memo(ToolInputTable)
