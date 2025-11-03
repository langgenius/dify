'use client'
import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import BlockSelector from '../../../../block-selector'
import type { Param, ParamType } from '../../types'
import cn from '@/utils/classnames'
import type {
  DataSourceDefaultValue,
  ToolDefaultValue,
} from '@/app/components/workflow/block-selector/types'
import type { ToolParameter } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import type { BlockEnum } from '@/app/components/workflow/types'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { canFindTool } from '@/utils'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllWorkflowTools,
} from '@/service/use-tools'

const i18nPrefix = 'workflow.nodes.parameterExtractor'

type Props = {
  onImport: (params: Param[]) => void
}

function toParmExactParams(toolParams: ToolParameter[], lan: string): Param[] {
  return toolParams.map((item) => {
    return {
      name: item.name,
      type: item.type as ParamType,
      required: item.required,
      description: item.llm_description,
      options: item.options?.map(option => option.label[lan] || option.label.en_US) || [],
    }
  })
}
const ImportFromTool: FC<Props> = ({
  onImport,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()

  const handleSelectTool = useCallback((_type: BlockEnum, toolInfo?: ToolDefaultValue | DataSourceDefaultValue) => {
    if (!toolInfo || 'datasource_name' in toolInfo)
      return

    const { provider_id, provider_type, tool_name } = toolInfo
    const currentTools = (() => {
      switch (provider_type) {
        case CollectionType.builtIn:
          return buildInTools || []
        case CollectionType.custom:
          return customTools || []
        case CollectionType.workflow:
          return workflowTools || []
        default:
          return []
      }
    })()
    const currCollection = currentTools.find(item => canFindTool(item.id, provider_id))
    const currTool = currCollection?.tools.find(tool => tool.name === tool_name)
    const toExactParams = (currTool?.parameters || []).filter(item => item.form === 'llm')
    const formattedParams = toParmExactParams(toExactParams, language)
    onImport(formattedParams)
  }, [buildInTools, customTools, language, onImport, workflowTools])

  const renderTrigger = useCallback((open: boolean) => {
    return (
      <div>
        <div className={cn(
          'flex h-6 cursor-pointer items-center rounded-md px-2 text-xs font-medium text-text-tertiary hover:bg-state-base-hover',
          open && 'bg-state-base-hover',
        )}>
          {t(`${i18nPrefix}.importFromTool`)}
        </div>
      </div>
    )
  }, [t])

  return (
    <BlockSelector
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 52,
      }}
      trigger={renderTrigger}
      onSelect={handleSelectTool}
      noBlocks
    />
  )
}
export default memo(ImportFromTool)
