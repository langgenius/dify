import type { NavIcon } from './nav-link'
import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import {
  RiMenuLine,
} from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useKnowledge } from '@/hooks/use-knowledge'
import { DOC_FORM_TEXT } from '@/models/datasets'
import { useDatasetRelatedApps } from '@/service/knowledge/use-dataset'
import AppIcon from '../base/app-icon'
import Divider from '../base/divider'
import Effect from '../base/effect'
import ExtraInfo from '../datasets/extra-info'
import Dropdown from './dataset-info/dropdown'
import NavLink from './nav-link'

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

  const [open, setOpen] = useState(false)

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
      <div className="fixed top-2 left-2 z-20">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger
            aria-label={t('operation.more', { ns: 'common' })}
            className={cn(
              'flex cursor-pointer items-center rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg p-1 shadow-lg backdrop-blur-xs hover:bg-background-default-hover',
              open && 'bg-background-default-hover',
            )}
          >
            <AppIcon
              size="small"
              iconType={iconInfo.icon_type}
              icon={iconInfo.icon}
              background={iconInfo.icon_background}
              imageUrl={iconInfo.icon_url}
            />
            <RiMenuLine className="size-4 text-text-tertiary" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            placement="bottom-start"
            sideOffset={4}
            popupClassName="border-none bg-transparent p-0 shadow-none backdrop-blur-none"
          >
            <div className="relative w-[216px] rounded-xl border-[0.5px] border-components-panel-border bg-background-default-subtle shadow-lg">
              <Effect className="top-[-22px] -left-5 opacity-15" />
              <div className="flex flex-col gap-y-2 p-4">
                <div className="flex items-center justify-between">
                  <AppIcon
                    size="medium"
                    iconType={iconInfo.icon_type}
                    icon={iconInfo.icon}
                    background={iconInfo.icon_background}
                    imageUrl={iconInfo.icon_url}
                  />
                  <Dropdown expand />
                </div>
                <div className="flex flex-col gap-y-1 pb-0.5">
                  <div
                    className="truncate system-md-semibold text-text-secondary"
                    title={dataset.name}
                  >
                    {dataset.name}
                  </div>
                  <div className="system-2xs-medium-uppercase text-text-tertiary">
                    {isExternalProvider && t('externalTag', { ns: 'dataset' })}
                    {!!(!isExternalProvider && dataset.doc_form && dataset.indexing_technique) && (
                      <div className="flex items-center gap-x-2">
                        <span>{t(`chunkingMode.${DOC_FORM_TEXT[dataset.doc_form]}`, { ns: 'dataset' })}</span>
                        <span>{formatIndexingTechniqueAndMethod(dataset.indexing_technique, dataset.retrieval_model_dict?.search_method)}</span>
                      </div>
                    )}
                  </div>
                </div>
                {!!dataset.description && (
                  <p className="line-clamp-3 system-xs-regular text-text-tertiary first-letter:capitalize">
                    {dataset.description}
                  </p>
                )}
              </div>
              <div className="px-4 py-2">
                <Divider
                  type="horizontal"
                  bgStyle="gradient"
                  className="my-0 h-px bg-linear-to-r from-divider-subtle to-background-gradient-mask-transparent"
                />
              </div>
              <nav className="flex min-h-[200px] grow flex-col gap-y-0.5 px-3 py-2">
                {navigation.map((item, index) => {
                  return (
                    <NavLink
                      key={index}
                      mode="expand"
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
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

export default DatasetSidebarDropdown
