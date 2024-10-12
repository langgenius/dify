'use client'
import React, { useEffect, useState } from 'react'
import type { FC } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RiVerifiedBadgeLine } from '@remixicon/react'
import Badge from '../../base/badge'
import type { Plugin } from '../types'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import Title from '../card/base/title'
import DownloadCount from '../card/base/download-count'
import type { Locale } from '@/i18n'
import { fetchPluginDetail } from '@/app/(commonLayout)/plugins/test/card/actions'
import Drawer from '@/app/components/base/drawer'
import Loading from '@/app/components/base/loading'
import cn from '@/utils/classnames'
import {
  // extensionDallE,
  // modelGPT4,
  toolNotion,
} from '@/app/components/plugins/card/card-mock'

type Props = {
  locale: Locale // The component is used in both client and server side, so we can't get the locale from both side(getLocaleOnServer and useContext)
}

const PluginDetailPanel: FC<Props> = ({
  locale,
}) => {
  const searchParams = useSearchParams()
  const pluginID = searchParams.get('pluginID')
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [pluginDetail, setPluginDetail] = useState<Plugin>()

  const getPluginDetail = async (pluginID: string) => {
    setLoading(true)
    const detail = await fetchPluginDetail(pluginID)
    setPluginDetail({
      ...detail,
      ...toolNotion,
    } as any)
    setLoading(false)
  }

  const handleClose = () => {
    setPluginDetail(undefined)
    router.replace(pathname)
  }

  useEffect(() => {
    if (pluginID)
      getPluginDetail(pluginID)
  }, [pluginID])

  if (!pluginID)
    return null

  return (
    <Drawer
      isOpen={!!pluginDetail}
      clickOutsideNotOpen={false}
      onClose={handleClose}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('mt-[65px] !w-[405px] !max-w-[405px]')}
    >
      {loading && <Loading type='area' />}
      {!loading && pluginDetail && (
        <div
          className={cn('w-full flex flex-col bg-white border-[0.5px] border-gray-200 rounded-xl shadow-xl')}
          style={{
            height: 'calc(100vh - 65px)',
          }}
        >
          <div className={cn('group relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs')}>
            {/* Header */}
            <div className="flex">
              <Icon src={pluginDetail.icon} />
              <div className="ml-3 w-0 grow">
                <div className="flex items-center h-5">
                  <Title title={pluginDetail.label[locale]} />
                  <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
                </div>
                <div className='mb-1 flex justify-between items-center h-4'>
                  <div className='flex items-center'>
                    <div className='text-text-tertiary system-xs-regular'>{pluginDetail.org}</div>
                    <div className='mx-2 text-text-quaternary system-xs-regular'>·</div>
                    <DownloadCount downloadCount={pluginDetail.install_count || 0} />
                  </div>
                </div>
              </div>
            </div>
            <Description className='mt-3' text={pluginDetail.brief[locale]} descriptionLineRows={2}></Description>
            <div className='mt-3 flex space-x-0.5'>
              {['LLM', 'text embedding', 'speech2text'].map(tag => (
                <Badge key={tag} text={tag} />
              ))}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
