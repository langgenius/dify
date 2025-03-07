import { memo, useCallback, useEffect, useState } from 'react'
import { BlockEnum } from '../../types'
import type { ToolDefaultValue } from '../../block-selector/types'
import type { ApoToolTypeInfo } from '../types'
import Input from '../../../base/input'
import { fetchApoTools } from '@/service/tools'
import { useTranslation } from 'react-i18next'
import ToolTrialRun from './tool-trial-run'
import ParametersInfo from './parameters-info'
import cn from '@/utils/classnames'
import { debounce } from 'lodash-es'
import { useGetLanguage } from '@/context/i18n'
import Button from '@/app/components/base/button'

type ApoToolsPreviewProps = {
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void;
  apoToolType: ApoToolTypeInfo | null;
  hidePopover: any
}

const ApoToolsPreview = ({ onSelect, apoToolType, hidePopover }: ApoToolsPreviewProps) => {
  const language = useGetLanguage()
  const { t } = useTranslation()
  const [toolDetail, setToolDetail] = useState()
  const [tools, setTools] = useState<any>([])
  const [provider, setProvider] = useState()
  const [searchText, setSearchText] = useState<string>()
  const getAllTools = async () => {
    const tools = await fetchApoTools(apoToolType, searchText)
    // setSearchText('')
    setProvider(tools[0])
    setTools(tools[0]?.tools)
  }
  const handlePopoverOpen = useCallback((item) => {
    setToolDetail(item)
  }, [])
  const handleSelect = (item) => {
    const params: Record<string, string> = {}
    if (item.parameters) {
      item.parameters.forEach((param) => {
        params[param.name] = ''
      })
    }
    onSelect(BlockEnum.Tool, {
      provider_id: provider.id,
      provider_type: provider.type,
      provider_name: provider.name,
      tool_name: item.name,
      tool_label: item.label[language],
      title: item.label[language],
      is_team_authorization: provider.is_team_authorization,
      output_schema: item.output_schema,
      paramSchemas: item.parameters,
      params,
    })
    hidePopover()
  }
  const convertMetricsListToMenuItems = useCallback(() => {
    return tools.map((item, index) => (
      <div
        key={index}
        className={cn(
          'flex items-center justify-between pl-3 pr-1 w-full rounded-lg hover:bg-state-base-hover cursor-pointer select-none',
          item.name === toolDetail?.name && 'bg-state-base-active text-red-500',
        )}
        onMouseEnter={() => handlePopoverOpen(item)}
      >
        <div className="flex grow items-center h-8">
          {/* <BlockIcon
          className='shrink-0'
          type={BlockEnum.Tool}
          toolIcon={item.icon}
        /> */}
          <div className="ml-2 text-sm text-text-primary flex-1 w-0 grow truncate">
            {item.label[language]}
          </div>
        </div>
      </div>
    ))
  }, [tools, handlePopoverOpen, toolDetail])

  useEffect(() => {
    const fetchTools = debounce(() => {
      if (apoToolType) getAllTools()
    }, 500) // 500ms 防抖

    fetchTools()

    return () => {
      fetchTools.cancel() // 组件卸载时清理
    }
  }, [apoToolType, searchText])
  return (
    <div className="flex max-h-[70vh] overflow-hidden">
      {/* left */}
      <div className="w-[300px] h-full flex flex-col shrink-0">
        <div className="mb-3">
          <Input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <div className="p-0.5 space-y-0.5 rounded-[10px] shrink grow overflow-y-auto">
          {tools?.length > 0 && convertMetricsListToMenuItems()}
        </div>
      </div>
      {toolDetail && (<div className="flex-1 min-w-[500px] overflow-auto max-w-[800px]">

        <div className="px-4">
          <div className='flex'>
            <div className='flex-1'>{toolDetail.label[language]}</div>
            <Button variant='primary' className=' space-x-2' onClick={() => handleSelect(toolDetail)}>
              <div>{t('apo.tool.use')}</div>
            </Button>
          </div>
          <div className="text-xs text-text-tertiary">
            <div className="pt-2">
              {t('apo.tool.desc')}：<>{toolDetail.description[language]}</>
            </div>
            <div className="pt-2">
              {apoToolType === 'apo_select' ? (
                <>
                  {toolDetail?.display.type === 'metric' && <div className="pb-2">{t('apo.tool.unit')}：{toolDetail.display.unit}</div>}
                  {toolDetail?.display?.type && <div>{t('apo.tool.output')}：{t(`apo.displayType.${toolDetail?.display?.type}`)}</div>}
                  <div className="px-4 py-2">
                    <div className="h-[0.5px] divider-subtle" />
                  </div>
                  <div className="pb-2">
                    <ToolTrialRun infoSchemas={toolDetail.parameters} type={toolDetail.display?.type} title={toolDetail?.display?.title}/>
                  </div>

                </>
              ) : (
                <div className="flex">
                  <span>{t('apo.tool.input')}：</span>
                  <div>
                    {toolDetail?.parameters.map(parameter => (
                      <ParametersInfo
                        key={parameter.name}
                        parameter={parameter}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}

export default memo(ApoToolsPreview)
