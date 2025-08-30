'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import cn from '@/utils/classnames'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useGetLanguage } from '@/context/i18n'
import type { Tool as ToolType } from '../../../tools/types'
import { CollectionType } from '../../../tools/types'
import type { ToolWithProvider } from '../../types'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue, ToolValue } from '../types'
import { ViewType } from '../view-type-select'
import ActionItem from './action-item'
import BlockIcon from '../../block-icon'
import { useTranslation } from 'react-i18next'
import { useHover } from 'ahooks'
import McpToolNotSupportTooltip from '../../nodes/_base/components/mcp-tool-not-support-tooltip'
import { Mcp } from '@/app/components/base/icons/src/vender/other'

type Props = {
  className?: string
  payload: ToolWithProvider
  viewType: ViewType
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
}

const Tool: FC<Props> = ({
  className,
  payload,
  viewType,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
  canChooseMCPTool,
}) => {
  const { t } = useTranslation()
  const language = useGetLanguage()
  const isFlatView = viewType === ViewType.flat
  const notShowProvider = payload.type === CollectionType.workflow
  const actions = payload.tools
  const hasAction = !notShowProvider
  const [isFold, setFold] = React.useState<boolean>(true)
  const ref = useRef(null)
  const isHovering = useHover(ref)
  const isMCPTool = payload.type === CollectionType.mcp
  const isShowCanNotChooseMCPTip = !canChooseMCPTool && isMCPTool
  const getIsDisabled = useCallback((tool: ToolType) => {
    if (!selectedTools || !selectedTools.length) return false
    return selectedTools.some(selectedTool => (selectedTool.provider_name === payload.name || selectedTool.provider_name === payload.id) && selectedTool.tool_name === tool.name)
  }, [payload.id, payload.name, selectedTools])

  const totalToolsNum = actions.length
  const selectedToolsNum = actions.filter(action => getIsDisabled(action)).length
  const isAllSelected = selectedToolsNum === totalToolsNum

  const notShowProviderSelectInfo = useMemo(() => {
    if (isAllSelected) {
      return (
        <span className='system-xs-regular text-text-tertiary'>
          {t('tools.addToolModal.added')}
        </span>
      )
    }
  }, [isAllSelected, t])
  const selectedInfo = useMemo(() => {
    if (isHovering && !isAllSelected) {
      return (
        <span className='system-xs-regular text-components-button-secondary-accent-text'
          onClick={(e) => {
            onSelectMultiple?.(BlockEnum.Tool, actions.filter(action => !getIsDisabled(action)).map((tool) => {
              const params: Record<string, string> = {}
              if (tool.parameters) {
                tool.parameters.forEach((item) => {
                  params[item.name] = ''
                })
              }
              return {
                provider_id: payload.id,
                provider_type: payload.type,
                provider_name: payload.name,
                tool_name: tool.name,
                tool_label: tool.label[language],
                tool_description: tool.description[language],
                title: tool.label[language],
                is_team_authorization: payload.is_team_authorization,
                output_schema: tool.output_schema,
                paramSchemas: tool.parameters,
                params,
              }
            }))
          }}
        >
          {t('workflow.tabs.addAll')}
        </span>
      )
    }

    if (selectedToolsNum === 0)
      return <></>

    return (
      <span className='system-xs-regular text-text-tertiary'>
        {isAllSelected
          ? t('workflow.tabs.allAdded')
          : `${selectedToolsNum} / ${totalToolsNum}`
        }
      </span>
    )
  }, [actions, getIsDisabled, isAllSelected, isHovering, language, onSelectMultiple, payload.id, payload.is_team_authorization, payload.name, payload.type, selectedToolsNum, t, totalToolsNum])

  useEffect(() => {
    if (hasSearchText && isFold) {
      setFold(false)
      return
    }
    if (!hasSearchText && !isFold)
      setFold(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSearchText])

  const FoldIcon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const groupName = useMemo(() => {
    if (payload.type === CollectionType.builtIn)
      return payload.author

    if (payload.type === CollectionType.custom)
      return t('workflow.tabs.customTool')

    if (payload.type === CollectionType.workflow)
      return t('workflow.tabs.workflowTool')

    return ''
  }, [payload.author, payload.type, t])

  return (
    <div
      key={payload.id}
      className={cn('mb-1 last-of-type:mb-0')}
      ref={ref}
    >
      <div className={cn(className)}>
        <div
          className='group/item flex w-full cursor-pointer select-none items-center justify-between rounded-lg pl-3 pr-1 hover:bg-state-base-hover'
          onClick={() => {
            if (hasAction) {
              setFold(!isFold)
              return
            }

            const tool = actions[0]
            const params: Record<string, string> = {}
            if (tool.parameters) {
              tool.parameters.forEach((item) => {
                params[item.name] = ''
              })
            }
            onSelect(BlockEnum.Tool, {
              provider_id: payload.id,
              provider_type: payload.type,
              provider_name: payload.name,
              tool_name: tool.name,
              tool_label: tool.label[language],
              tool_description: tool.description[language],
              title: tool.label[language],
              is_team_authorization: payload.is_team_authorization,
              output_schema: tool.output_schema,
              paramSchemas: tool.parameters,
              params,
            })
          }}
        >
          <div className={cn('flex h-8 grow items-center', isShowCanNotChooseMCPTip && 'opacity-30')}>
            <BlockIcon
              className='shrink-0'
              type={BlockEnum.Tool}
              toolIcon={payload.icon}
            />
            <div className='ml-2 flex w-0 grow items-center text-sm text-text-primary'>
              <span className='max-w-[250px] truncate'>{notShowProvider ? actions[0]?.label[language] : payload.label[language]}</span>
              {isFlatView && groupName && (
                <span className='system-xs-regular ml-2 shrink-0 text-text-quaternary'>{groupName}</span>
              )}
              {isMCPTool && <Mcp className='ml-2 size-3.5 shrink-0 text-text-quaternary' />}
            </div>
          </div>

          <div className='ml-2 flex items-center'>
            {!isShowCanNotChooseMCPTip && !canNotSelectMultiple && (notShowProvider ? notShowProviderSelectInfo : selectedInfo)}
            {isShowCanNotChooseMCPTip && <McpToolNotSupportTooltip />}
            {hasAction && (
              <FoldIcon className={cn('h-4 w-4 shrink-0 text-text-tertiary group-hover/item:text-text-tertiary', isFold && 'text-text-quaternary')} />
            )}
          </div>
        </div>

        {!notShowProvider && hasAction && !isFold && (
          actions.map(action => (
            <ActionItem
              key={action.name}
              provider={payload}
              payload={action}
              onSelect={onSelect}
              disabled={getIsDisabled(action) || isShowCanNotChooseMCPTip}
              isAdded={getIsDisabled(action)}
            />
          ))
        )}
      </div>
    </div>
  )
}
export default React.memo(Tool)
