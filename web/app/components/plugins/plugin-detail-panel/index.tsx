'use client'
import React, { useMemo } from 'react'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import { RiCloseLine, RiVerifiedBadgeLine } from '@remixicon/react'
import type { Plugin } from '../types'
// import { PluginType } from '../types'
import Badge from '../../base/badge'
import Description from '../card/base/description'
import Icon from '../card/base/card-icon'
import Title from '../card/base/title'
import OperationDropdown from './operation-dropdown'
import EndpointList from './endpoint-list'
import ActionList from './action-list'
import ModelList from './model-list'
// import type { Locale } from '@/i18n'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import Button from '@/app/components/base/button'
import ActionButton from '@/app/components/base/action-button'
import Drawer from '@/app/components/base/drawer'
// import Loading from '@/app/components/base/loading'
import I18n from '@/context/i18n'
import cn from '@/utils/classnames'

type Props = {
  pluginDetail: Plugin | undefined
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
    return pluginDetail.latest_version !== pluginDetail.version
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
              <Icon src={pluginDetail.icon} />
              <div className="ml-3 w-0 grow">
                <div className="flex items-center h-5">
                  <Title title={pluginDetail.label[locale]} />
                  <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />
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
                    <div className='text-text-tertiary system-xs-regular'>{pluginDetail.org}</div>
                    <div className='ml-1 text-text-quaternary system-xs-regular'>·</div>
                    <BoxSparkleFill className='w-3.5 h-3.5 text-text-tertiary' />
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
            <Description className='mt-3' text={pluginDetail.brief[locale]} descriptionLineRows={2}></Description>
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
