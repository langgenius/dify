'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { useFetchPluginListOrBundleList } from '@/service/use-plugins'
import { PLUGIN_TYPE_SEARCH_MAP } from '../../marketplace/plugin-type-switch'

type Props = {
    trigger: React.ReactNode
  value: string[]
  onChange: (value: string[]) => void
  isShow: boolean
  onShowChange: (isShow: boolean) => void

}

const allPluginTypes = [PLUGIN_TYPE_SEARCH_MAP.all, PLUGIN_TYPE_SEARCH_MAP.model, PLUGIN_TYPE_SEARCH_MAP.tool, PLUGIN_TYPE_SEARCH_MAP.agent, PLUGIN_TYPE_SEARCH_MAP.extension, PLUGIN_TYPE_SEARCH_MAP.bundle]

const ToolPicker: FC<Props> = ({
  trigger,
  value,
  onChange,
  isShow,
  onShowChange,
}) => {
  const toggleShowPopup = useCallback(() => {
    onShowChange(!isShow)
  }, [onShowChange, isShow])

  const [pluginType, setPluginType] = useState(PLUGIN_TYPE_SEARCH_MAP.all)
  const [query, setQuery] = useState('')
  const { data } = useFetchPluginListOrBundleList({
    query,
    category: pluginType,
  })
  const isBundle = pluginType === PLUGIN_TYPE_SEARCH_MAP.bundle
  const list = (isBundle ? data?.data?.bundles : data?.data?.plugins) || []
  console.log(list)
  return (
    <PortalToFollowElem
        placement='top-start'
        offset={0}
        open={isShow}
        onOpenChange={onShowChange}
      >
        <PortalToFollowElemTrigger
          onClick={toggleShowPopup}
        >
          {trigger}
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className='z-[1000]'>
          <div>aafdf</div>
        </PortalToFollowElemContent>
      </PortalToFollowElem>
  )
}
export default React.memo(ToolPicker)
