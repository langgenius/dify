'use client'

import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { RiArrowLeftRightLine } from '@remixicon/react'
import { type FC, useCallback, useState } from 'react'
import cn from '@/utils/classnames'
import UpdateFromMarketplace from '@/app/components/plugins/update-plugin/from-market-place'
import { useBoolean } from 'ahooks'
import { useCheckInstalled } from '@/service/use-plugins'

export type SwitchPluginVersionProps = {
  uniqueIdentifier: string
  tooltip?: string
  version: string
  onSelect: (version: string) => void
}

export const SwitchPluginVersion: FC<SwitchPluginVersionProps> = (props) => {
  const { uniqueIdentifier, tooltip, onSelect, version } = props
  const [pluginId] = uniqueIdentifier.split(':')
  const [isShow, setIsShow] = useState(false)
  const [isShowUpdateModal, { setTrue: showUpdateModal, setFalse: hideUpdateModal }] = useBoolean(false)
  const [targetVersion, setTargetVersion] = useState<string>()
  const pluginDetails = useCheckInstalled({
    pluginIds: [pluginId],
    enabled: true,
  })
  const pluginDetail = pluginDetails.data?.plugins.at(0)

  const handleUpdatedFromMarketplace = useCallback(() => {
    hideUpdateModal()
    onSelect(targetVersion!)
  }, [hideUpdateModal, onSelect, targetVersion])
  return <Tooltip popupContent={!isShow && tooltip} triggerMethod='hover'>
    <div className='w-fit'>
      {isShowUpdateModal && pluginDetail && <UpdateFromMarketplace
        payload={{
          originalPackageInfo: {
            id: uniqueIdentifier,
            payload: pluginDetail.declaration,
          },
          targetPackageInfo: {
            id: uniqueIdentifier,
            version: targetVersion!,
          },
        }}
        onCancel={hideUpdateModal}
        onSave={handleUpdatedFromMarketplace}
      />}
      <PluginVersionPicker
        isShow={isShow}
        onShowChange={setIsShow}
        pluginID={pluginId}
        currentVersion={version}
        onSelect={(state) => {
          setTargetVersion(state.version)
          showUpdateModal()
        }}
        trigger={
          <Badge
            className={cn(
              'mx-1 hover:bg-state-base-hover flex',
              isShow && 'bg-state-base-hover',
            )}
            uppercase={true}
            text={
              <>
                <div>{version}</div>
                <RiArrowLeftRightLine className='ml-1 w-3 h-3 text-text-tertiary' />
              </>
            }
            hasRedCornerMark={true}
          />
        }
      />
    </div>
  </Tooltip>
}
