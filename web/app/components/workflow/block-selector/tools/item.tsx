import {
  memo,
  useCallback,
  useEffect,
  useMemo,
} from 'react'
import { useContext } from 'use-context-selector'
import { BlockEnum } from '../../types'
import type {
  CollectionWithExpanded,
  ToolDefaultValue,
  ToolInWorkflow,
} from '../types'
import AppIcon from '@/app/components/base/app-icon'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import {
  fetchBuiltInToolList,
  fetchCustomToolList,
} from '@/service/tools'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
import Loading from '@/app/components/base/loading'

type ItemProps = {
  data: CollectionWithExpanded
  tools: ToolInWorkflow[]
  onExpand: (toolsetId: string) => void
  onAddTools: (toolsetId: string, tools: ToolInWorkflow[]) => void
  onFetched: (toolsetId: string) => void
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}
const Item = ({
  data,
  tools,
  onExpand,
  onAddTools,
  onFetched,
  onSelect,
}: ItemProps) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)

  const fetchToolList = useMemo(() => {
    return data.type === 'api' ? fetchCustomToolList : fetchBuiltInToolList
  }, [data.type])

  const handleFetchToolList = useCallback(() => {
    fetchToolList(data.name).then((list) => {
      onAddTools(data.id, list)
    }).finally(() => {
      onFetched(data.id)
    })
  }, [data.id, data.name, fetchToolList, onAddTools, onFetched])

  useEffect(() => {
    if (data.fetching)
      handleFetchToolList()
  }, [data.fetching, handleFetchToolList])

  return (
    <>
      <div
        className='flex items-center pl-3 pr-2.5 h-8 cursor-pointer'
        key={data.id}
        onClick={() => onExpand(data.id)}
      >
        {
          typeof data.icon === 'string'
            ? (
              <div
                className='shrink-0 mr-2 w-5 h-5 bg-cover bg-center rounded-md'
                style={{
                  backgroundImage: `url(${data.icon})`,
                }}
              ></div>
            )
            : (
              <AppIcon
                className='shrink-0 mr-2 !w-5 !h-5 !text-sm'
                size='tiny'
                icon={data.icon.content}
                background={data.icon.background}
              />
            )
        }
        <div
          className='grow mr-2 truncate text-sm text-gray-900'
          title={data.label[language]}
        >
          {data.label[language]}
        </div>
        {
          data.expanded
            ? <ChevronDown className='shrink-0 w-3 h-3 text-gray-500' />
            : <ChevronDown className='shrink-0 w-3 h-3 text-gray-500 -rotate-90' />
        }
      </div>
      {
        data.expanded && !data.fetching && tools.map(tool => (
          <div
            key={tool.name}
            className='relative flex items-center pl-10 pr-3 h-8 rounded-lg truncate cursor-pointer text-sm text-gray-900 hover:bg-black/5'
            title={tool.label[language]}
            onClick={() => onSelect(BlockEnum.Tool, {
              provider_id: data.id,
              provider_type: data.type,
              tool_name: tool.name,
              title: tool.label[language],
              _icon: data.icon,
              _about: tool.description[language],
              _author: data.author,
            })}
          >
            <div className='absolute left-[22px] w-[1px] h-8 bg-black/5' />
            {tool.label[language]}
          </div>
        ))
      }
      {
        data.expanded && data.fetching && (
          <div className='felx items-center justify-center h-8'>
            <Loading />
          </div>
        )
      }
    </>
  )
}

export default memo(Item)
