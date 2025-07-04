'use client'

import Badge from '@/app/components/base/badge'
import Tooltip from '@/app/components/base/tooltip'
import PluginVersionPicker from '@/app/components/plugins/update-plugin/plugin-version-picker'
import { RiArrowLeftRightLine, RiExternalLinkLine } from '@remixicon/react'
import type { ReactNode } from 'react'
import { type FC, useCallback, useState } from 'react'
import { useBoolean } from 'ahooks'
import { useCheckInstalled, useUpdatePackageFromMarketPlace } from '@/service/use-plugins'
import cn from '@/utils/classnames'
import PluginMutationModel from '@/app/components/plugins/plugin-mutation-model'
import useGetIcon from '@/app/components/plugins/install-plugin/base/use-get-icon'
import { pluginManifestToCardPluginProps } from '@/app/components/plugins/install-plugin/utils'
import { Badge as Badge2, BadgeState } from '@/app/components/base/badge/index'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { getMarketplaceUrl } from '@/utils/var'

export type SwitchPluginVersionProps = {
  uniqueIdentifier: string
  tooltip?: ReactNode
  onChange?: (version: string) => void
  className?: string
}

export const SwitchPluginVersion: FC<SwitchPluginVersionProps> = (props) => {
  const { uniqueIdentifier, tooltip, onChange, className } = props
  const [pluginId] = uniqueIdentifier.split(':')
  const [isShow, setIsShow] = useState(false)
  const [isShowUpdateModal, { setTrue: showUpdateModal, setFalse: hideUpdateModal }] = useBoolean(false)
  const [target, setTarget] = useState<{
    version: string,
    pluginUniqueIden: string;
  }>()
  const pluginDetails = useCheckInstalled({
    pluginIds: [pluginId],
    enabled: true,
  })
  const pluginDetail = pluginDetails.data?.plugins.at(0)

  const handleUpdatedFromMarketplace = useCallback(() => {
    hideUpdateModal()
    pluginDetails.refetch()
    onChange?.(target!.version)
  }, [hideUpdateModal, onChange, pluginDetails, target])
  const { getIconUrl } = useGetIcon()
  const icon = pluginDetail?.declaration.icon ? getIconUrl(pluginDetail.declaration.icon) : undefined
  const mutation = useUpdatePackageFromMarketPlace()
  const install = () => {
    mutation.mutate(
      {
        new_plugin_unique_identifier: target!.pluginUniqueIden,
        original_plugin_unique_identifier: uniqueIdentifier,
      },
      {
        onSuccess() {
          handleUpdatedFromMarketplace()
        },
      })
  }
  const { t } = useTranslation()
  return <Tooltip popupContent={!isShow && !isShowUpdateModal && tooltip} triggerMethod='hover'>
    <div className={cn('flex w-fit items-center justify-center', className)} onClick={e => e.stopPropagation()}>
      {isShowUpdateModal && pluginDetail && <PluginMutationModel
        onCancel={hideUpdateModal}
        plugin={pluginManifestToCardPluginProps({
          ...pluginDetail.declaration,
          icon: icon!,
        })}
        mutation={mutation}
        mutate={install}
        confirmButtonText={t('workflow.nodes.agent.installPlugin.install')}
        cancelButtonText={t('workflow.nodes.agent.installPlugin.cancel')}
        modelTitle={t('workflow.nodes.agent.installPlugin.title')}
        description={t('workflow.nodes.agent.installPlugin.desc')}
        cardTitleLeft={<>
          <Badge2 className='mx-1' size="s" state={BadgeState.Warning}>
            {`${pluginDetail.version} -> ${target!.version}`}
          </Badge2>
        </>}
        modalBottomLeft={
          <Link
            className='flex items-center justify-center gap-1'
            href={getMarketplaceUrl(`/plugins/${pluginDetail.declaration.author}/${pluginDetail.declaration.name}`)}
            target='_blank'
          >
            <span className='system-xs-regular text-xs text-text-accent'>
              {t('workflow.nodes.agent.installPlugin.changelog')}
            </span>
            <RiExternalLinkLine className='size-3 text-text-accent' />
          </Link>
        }
      />}
      {pluginDetail && <PluginVersionPicker
        isShow={isShow}
        onShowChange={setIsShow}
        pluginID={pluginId}
        currentVersion={pluginDetail.version}
        onSelect={(state) => {
          setTarget({
            pluginUniqueIden: state.unique_identifier,
            version: state.version,
          })
          showUpdateModal()
        }}
        trigger={
          <Badge
            className={cn(
              'mx-1 flex hover:bg-state-base-hover',
              isShow && 'bg-state-base-hover',
            )}
            uppercase={true}
            text={
              <>
                <div>{pluginDetail.version}</div>
                <RiArrowLeftRightLine className='ml-1 h-3 w-3 text-text-tertiary' />
              </>
            }
            hasRedCornerMark={true}
          />
        }
      />}
    </div>
  </Tooltip>
}
