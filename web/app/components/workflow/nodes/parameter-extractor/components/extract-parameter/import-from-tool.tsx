'use client'
import type { FC } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import BlockSelector from '../../../../block-selector'
import type { Param, ParamType } from '../../types'
import { useStore } from '@/app/components/workflow/store'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import type { ToolParameter } from '@/app/components/tools/types'
import { CollectionType } from '@/app/components/tools/types'
import type { BlockEnum } from '@/app/components/workflow/types'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'

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

  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)

  const handleSelectTool = useCallback((_type: BlockEnum, toolInfo?: ToolDefaultValue) => {
    const { provider_id, provider_type, tool_name } = toolInfo!
    const currentTools = (() => {
      switch (provider_type) {
        case CollectionType.builtIn:
          return buildInTools
        case CollectionType.custom:
          return customTools
        case CollectionType.workflow:
          return workflowTools
        default:
          return []
      }
    })()
    const currCollection = currentTools.find(item => item.id === provider_id)
    const currTool = currCollection?.tools.find(tool => tool.name === tool_name)
    const toExactParams = (currTool?.parameters || []).filter((item: any) => item.form === 'llm')
    const formattedParams = toParmExactParams(toExactParams, language)
    onImport(formattedParams)
  }, [buildInTools, customTools, language, onImport, workflowTools])

  const renderTrigger = useCallback((open: boolean) => {
    return (
      <div>
        <div className={cn(
          'flex items-center h-6 px-2 cursor-pointer rounded-md hover:bg-gray-100 text-xs font-medium text-gray-500',
          open && 'bg-gray-100',
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
