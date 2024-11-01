import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useBoolean } from 'ahooks'
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
import PluginInfo from '@/app/components/plugins/plugin-page/plugin-info'
import ActionButton from '@/app/components/base/action-button'
import Button from '@/app/components/base/button'
import Badge from '@/app/components/base/badge'
import Confirm from '@/app/components/base/confirm'
import Tooltip from '@/app/components/base/tooltip'
import { BoxSparkleFill } from '@/app/components/base/icons/src/vender/plugin'
import { Github } from '@/app/components/base/icons/src/public/common'
import I18n from '@/context/i18n'
import cn from '@/utils/classnames'

const i18nPrefix = 'plugin.action'

type Props = {
  detail: PluginDetail
  onHide: () => void
  onDelete: () => void
}

const DetailHeader = ({
  detail,
  onHide,
  onDelete,
}: Props) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)

  const hasNewVersion = useMemo(() => {
    if (!detail)
      return false
    return false
    // return pluginDetail.latest_version !== pluginDetail.version
  }, [detail])

  const handleUpdate = () => {}

  const [isShowPluginInfo, {
    setTrue: showPluginInfo,
    setFalse: hidePluginInfo,
  }] = useBoolean(false)

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)

  const usedInApps = 3

  return (
    <div className={cn('shrink-0 p-4 pb-3 border-b border-divider-subtle bg-components-panel-bg')}>
      <div className="flex">
        <Icon src={detail.declaration.icon} />
        <div className="ml-3 w-0 grow">
          <div className="flex items-center h-5">
            <Title title={detail.declaration.label[locale]} />
            {detail.declaration.verified && <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" />}
            <Badge
              className='mx-1'
              text={detail.version}
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
                orgName={detail.declaration.author}
                packageName={detail.declaration.name}
              />
              <div className='ml-1 mr-0.5 text-text-quaternary system-xs-regular'>·</div>
              {detail.source === PluginSource.marketplace && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.marketplace')} >
                  <BoxSparkleFill className='w-3.5 h-3.5 text-text-tertiary hover:text-text-accent' />
                </Tooltip>
              )}
              {detail.source === PluginSource.github && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.github')} >
                  <Github className='w-3.5 h-3.5 text-text-secondary hover:text-text-primary' />
                </Tooltip>
              )}
              {detail.source === PluginSource.local && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.local')} >
                  <RiHardDrive3Line className='w-3.5 h-3.5 text-text-tertiary' />
                </Tooltip>
              )}
              {detail.source === PluginSource.debugging && (
                <Tooltip popupContent={t('plugin.detailPanel.categoryTip.debugging')} >
                  <RiBugLine className='w-3.5 h-3.5 text-text-tertiary hover:text-text-warning' />
                </Tooltip>
              )}
            </div>
          </div>
        </div>
        <div className='flex gap-1'>
          <OperationDropdown
            onInfo={showPluginInfo}
            onRemove={showDeleteConfirm}
          />
          <ActionButton onClick={onHide}>
            <RiCloseLine className='w-4 h-4' />
          </ActionButton>
        </div>
      </div>
      <Description className='mt-3' text={detail.declaration.description[locale]} descriptionLineRows={2}></Description>
      {isShowPluginInfo && (
        <PluginInfo
          repository={detail.meta?.repo}
          release={detail.version}
          packageName={detail.meta?.package}
          onHide={hidePluginInfo}
        />
      )}
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t(`${i18nPrefix}.delete`)}
          content={
            <div>
              {t(`${i18nPrefix}.deleteContentLeft`)}<span className='system-md-semibold'>{detail.declaration.label[locale]}</span>{t(`${i18nPrefix}.deleteContentRight`)}<br />
              {usedInApps > 0 && t(`${i18nPrefix}.usedInApps`, { num: usedInApps })}
            </div>
          }
          onCancel={hideDeleteConfirm}
          onConfirm={onDelete}
        />
      )}
    </div>
  )
}

export default DetailHeader
