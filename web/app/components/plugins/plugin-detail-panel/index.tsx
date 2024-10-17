'use client'
import React, { useMemo } from 'react'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import {
  RiBugLine,
  RiCloseLine,
  RiHardDrive3Line,
  RiVerifiedBadgeLine,
} from '@remixicon/react'
import type { PluginDetail } from '../types'
import { PluginSource } from '../types'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import Title from '../card/base/title'
import OrgInfo from '../card/base/org-info'
import OperationDropdown from './operation-dropdown'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import ModelList from './model-list'
import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import { Github } from '@/app/components/base/icons/src/public/common'
import Button from '@/app/components/base/button'
import ActionButton from '@/app/components/base/action-button'
import Drawer from '@/app/components/base/drawer'
// import Loading from '@/app/components/base/loading'
import I18n from '@/context/i18n'
import cn from '@/utils/classnames'

type Props = {
  pluginDetail: PluginDetail | undefined
  onHide: () => void
}

const PluginDetailPanel: FC<Props> = ({
  pluginDetail,
  onHide,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  const hasNewVersion = useMemo(() => {
    if (!pluginDetail)
      return false
    return false // TODO
    // return pluginDetail.latest_version !== pluginDetail.version
  }, [pluginDetail])

  const handleUpdate = () => {}

  if (!pluginDetail)
    return null

  return (
    <Drawer
      isOpen={!!pluginDetail}
      clickOutsideNotOpen={false}
      onClose={onHide}
      footer={null}
      mask={false}
      positionCenter={false}
      panelClassname={cn('justify-start mt-[64px] mr-2 mb-2 !w-[420px] !max-w-[420px] !p-0 !bg-components-panel-bg rounded-2xl border-[0.5px] border-components-panel-border shadow-xl')}
    >
      {/* {loading && <Loading type='area' />} */}
      {pluginDetail && (
        <>
          <div className={cn('shrink-0 p-4 pb-3 border-b border-divider-subtle bg-components-panel-bg')}>
            <div className="flex">
              <Icon src={pluginDetail.declaration.icon} />
              <div className="ml-3 w-0 grow">
                <div className="flex items-center h-5">
                  <Title title={pluginDetail.declaration.label[locale]} />
                  {pluginDetail.declaration.verified && <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />}
                  <Badge
                    className='mx-1'
                    text={pluginDetail.version}
                    hasRedCornerMark={hasNewVersion}
                  />
                  {hasNewVersion && (
                    <Button variant='secondary-accent' size='small' className='!h-5' onClick={handleUpdate}>{t('plugin.detailPanel.operation.update')}</Button>
                  )}
                </div>
                <div className='mb-1 flex justify-between items-center h-4'>
                  <div className='flex items-center'>
                    <OrgInfo
                      className="mt-0.5"
                      packageNameClassName='w-auto'
                      orgName={pluginDetail.declaration.author}
                      packageName={pluginDetail.declaration.name}
                    />
                    <div className='ml-1 mr-0.5 text-text-quaternary system-xs-regular'>·</div>
                    {pluginDetail.source === PluginSource.marketplace && (
                      <Tooltip popupContent={t('plugin.detailPanel.categoryTip.marketplace')} >
                        <BoxSparkleFill className='w-3.5 h-3.5 text-text-tertiary hover:text-text-accent' />
                      </Tooltip>
                    )}
                    {pluginDetail.source === PluginSource.github && (
                      <Tooltip popupContent={t('plugin.detailPanel.categoryTip.github')} >
                        <Github className='w-3.5 h-3.5 text-text-secondary hover:text-text-primary' />
                      </Tooltip>
                    )}
                    {pluginDetail.source === PluginSource.local && (
                      <Tooltip popupContent={t('plugin.detailPanel.categoryTip.local')} >
                        <RiHardDrive3Line className='w-3.5 h-3.5 text-text-tertiary' />
                      </Tooltip>
                    )}
                    {pluginDetail.source === PluginSource.debugging && (
                      <Tooltip popupContent={t('plugin.detailPanel.categoryTip.debugging')} >
                        <RiBugLine className='w-3.5 h-3.5 text-text-tertiary hover:text-text-warning' />
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
              <div className='flex gap-1'>
                <OperationDropdown />
                <ActionButton onClick={onHide}>
                  <RiCloseLine className='w-4 h-4' />
                </ActionButton>
              </div>
            </div>
            <Description className='mt-3' text={pluginDetail.declaration.description[locale]} descriptionLineRows={2}></Description>
          </div>
          <div className='grow overflow-y-auto'>
            <ActionList />
            <EndpointList />
            <ModelList />
          </div>
        </>
      )}
    </Drawer>
  )
}

export default PluginDetailPanel
