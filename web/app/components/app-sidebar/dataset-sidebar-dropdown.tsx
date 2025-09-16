import React, { useCallback, useRef, useState } from 'react'
import {
  RiMenuLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import AppIcon from '../base/app-icon'
import Divider from '../base/divider'
import NavLink from './navLink'
import type { NavIcon } from './navLink'
import cn from '@/utils/classnames'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import Effect from '../base/effect'
import Dropdown from './dataset-info/dropdown'
import type { DataSet } from '@/models/datasets'
import { DOC_FORM_TEXT } from '@/models/datasets'
import { useKnowledge } from '@/hooks/use-knowledge'
import { useTranslation } from 'react-i18next'
import { useDatasetRelatedApps } from '@/service/knowledge/use-dataset'
import ExtraInfo from '../datasets/extra-info'

type DatasetSidebarDropdownProps = {
  navigation: Array<{
    name: string
    href: string
    icon: NavIcon
    selectedIcon: NavIcon
    disabled?: boolean
  }>
}

const DatasetSidebarDropdown = ({
  navigation,
}: DatasetSidebarDropdownProps) => {
  const { t } = useTranslation()
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset) as DataSet

  const { data: relatedApps } = useDatasetRelatedApps(dataset.id)

  const [open, doSetOpen] = useState(false)
  const openRef = useRef(open)
  const setOpen = useCallback((v: boolean) => {
    doSetOpen(v)
    openRef.current = v
  }, [doSetOpen])
  const handleTrigger = useCallback(() => {
    setOpen(!openRef.current)
  }, [setOpen])

  const iconInfo = dataset.icon_info || {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  }
  const isExternalProvider = dataset.provider === 'external'
  const { formatIndexingTechniqueAndMethod } = useKnowledge()

  if (!dataset)
    return null

  return (
    <>
      <div className='fixed left-2 top-2 z-20'>
        <PortalToFollowElem
          open={open}
          onOpenChange={setOpen}
          placement='bottom-start'
          offset={{
            mainAxis: -41,
          }}
        >
          <PortalToFollowElemTrigger onClick={handleTrigger}>
            <div
              className={cn(
                'flex cursor-pointer items-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-1 shadow-lg backdrop-blur-sm hover:bg-background-default-hover',
                open && 'bg-background-default-hover',
              )}
            >
              <AppIcon
                size='small'
                iconType={iconInfo.icon_type}
                icon={iconInfo.icon}
                background={iconInfo.icon_background}
                imageUrl={iconInfo.icon_url}
              />
              <RiMenuLine className='size-4 text-text-tertiary' />
            </div>
          </PortalToFollowElemTrigger>
          <PortalToFollowElemContent className='z-50'>
            <div className='relative w-[216px] rounded-xl border-[0.5px] border-components-panel-border bg-background-default-subtle shadow-lg'>
              <Effect className='-left-5 top-[-22px] opacity-15' />
              <div className='flex flex-col gap-y-2 p-4'>
                <div className='flex items-center justify-between'>
                  <AppIcon
                    size='medium'
                    iconType={iconInfo.icon_type}
                    icon={iconInfo.icon}
                    background={iconInfo.icon_background}
                    imageUrl={iconInfo.icon_url}
                  />
                  <Dropdown expand />
                </div>
                <div className='flex flex-col gap-y-1 pb-0.5'>
                  <div
                    className='system-md-semibold truncate text-text-secondary'
                    title={dataset.name}
                  >
                    {dataset.name}
                  </div>
                  <div className='system-2xs-medium-uppercase text-text-tertiary'>
                    {isExternalProvider && t('dataset.externalTag')}
                    {!isExternalProvider && dataset.doc_form && dataset.indexing_technique && (
                      <div className='flex items-center gap-x-2'>
                        <span>{t(`dataset.chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`)}</span>
                        <span>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</span>
                      </div>
                    )}
                  </div>
                </div>
                {!!dataset.description && (
                  <p className='system-xs-regular line-clamp-3 text-text-tertiary first-letter:capitalize'>
                    {dataset.description}
                  </p>
                )}
              </div>
              <div className='px-4 py-2'>
                <Divider
                  type='horizontal'
                  bgStyle='gradient'
                  className='my-0 h-px bg-gradient-to-r from-divider-subtle to-background-gradient-mask-transparent'
                />
              </div>
              <nav className='flex min-h-[200px] grow flex-col gap-y-0.5 px-3 py-2'>
                {navigation.map((item, index) => {
                  return (
                    <NavLink
                      key={index}
                      mode='expand'
                      iconMap={{ selected: item.selectedIcon, normal: item.icon }}
                      name={item.name}
                      href={item.href}
                      disabled={!!item.disabled}
                    />
                  )
                })}
              </nav>
              <ExtraInfo
                relatedApps={relatedApps}
                expand
                documentCount={dataset.document_count}
              />
            </div>
          </PortalToFollowElemContent>
        </PortalToFollowElem>
      </div>
    </>
  )
}

export default DatasetSidebarDropdown
