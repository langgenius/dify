'use client'
import type { FC } from 'react'
import React from 'react'
import type { InstallStatusResponse, Plugin } from '../../../types'
import Card from '@/app/components/plugins/card'
import Button from '@/app/components/base/button'
import { useTranslation } from 'react-i18next'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import useGetIcon from '../../base/use-get-icon'
import { MARKETPLACE_API_PREFIX } from '@/config'

type Props = {
  list: Plugin[]
  installStatus: InstallStatusResponse[]
  onCancel: () => void
  isHideButton?: boolean
}

const Installed: FC<Props> = ({
  list,
  installStatus,
  onCancel,
  isHideButton,
}) => {
  const { t } = useTranslation()
  const { getIconUrl } = useGetIcon()
  return (
    <>
      <div className='flex flex-col px-6 py-3 justify-center items-start gap-4 self-stretch'>
        {/* <p className='text-text-secondary system-md-regular'>{(isFailed && errMsg) ? errMsg : t(`plugin.installModal.${isFailed ? 'installFailedDesc' : 'installedSuccessfullyDesc'}`)}</p> */}
        <div className='flex p-2 items-start content-start gap-1 self-stretch flex-wrap rounded-2xl bg-background-section-burn space-y-1'>
          {list.map((plugin, index) => {
            return (
              <Card
                key={plugin.plugin_id}
                className='w-full'
                payload={{
                  ...plugin,
                  icon: installStatus[index].isFromMarketPlace ? `${MARKETPLACE_API_PREFIX}/plugins/${plugin.org}/${plugin.name}/icon` : getIconUrl(plugin.icon),
                }}
                installed={installStatus[index].success}
                installFailed={!installStatus[index].success}
                titleLeft={plugin.version ? <Badge className='mx-1' size="s" state={BadgeState.Default}>{plugin.version}</Badge> : null}
              />
            )
          })}
        </div>
      </div>
      {/* Action Buttons */}
      {!isHideButton && (
        <div className='flex p-6 pt-5 justify-end items-center gap-2 self-stretch'>
          <Button
            variant='primary'
            className='min-w-[72px]'
            onClick={onCancel}
          >
            {t('common.operation.close')}
          </Button>
        </div>
      )}
    </>
  )
}

export default React.memo(Installed)
