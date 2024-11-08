import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import { useBoolean } from 'ahooks'
import { RiAddLine } from '@remixicon/react'
import EndpointModal from './endpoint-modal'
import EndpointCard from './endpoint-card'
import { NAME_FIELD } from './utils'
import { toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import {
  createEndpoint,
  fetchEndpointList,
} from '@/service/plugins'
import cn from '@/utils/classnames'

type Props = {
  showTopBorder?: boolean
}
const EndpointList = ({ showTopBorder }: Props) => {
  const { t } = useTranslation()
  const pluginDetail = usePluginPageContext(v => v.currentPluginDetail)
  const pluginUniqueID = pluginDetail.plugin_unique_identifier
  const declaration = pluginDetail.declaration.endpoint
  const { data, mutate } = useSWR(
    {
      url: '/workspaces/current/endpoints/list/plugin',
      params: {
        plugin_id: pluginDetail.plugin_id,
        page: 1,
        page_size: 100,
      },
    },
    fetchEndpointList,
  )
  const [isShowEndpointModal, {
    setTrue: showEndpointModal,
    setFalse: hideEndpointModal,
  }] = useBoolean(false)

  const formSchemas = useMemo(() => {
    return toolCredentialToFormSchemas([NAME_FIELD, ...declaration.settings])
  }, [declaration.settings])

  const handleCreate = async (state: any) => {
    const newName = state.name
    delete state.name
    try {
      await createEndpoint({
        url: '/workspaces/current/endpoints/create',
        body: {
          plugin_unique_identifier: pluginUniqueID,
          settings: state,
          name: newName,
        },
      })
      await mutate()
      hideEndpointModal()
    }
    catch (error) {
      console.error(error)
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    }
  }

  if (!data)
    return null

  return (
    <div className={cn('px-4 py-2 border-divider-subtle', showTopBorder && 'border-t')}>
      <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold-uppercase'>
        <div className='flex items-center gap-0.5'>
          {t('plugin.detailPanel.endpoints')}
          <Tooltip
            popupContent={
              <div className='w-[180px]'>TODO</div>
            }
          />
        </div>
        <ActionButton onClick={showEndpointModal}>
          <RiAddLine className='w-4 h-4' />
        </ActionButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className='mb-1 p-3 flex justify-center rounded-[10px] bg-background-section text-text-tertiary system-xs-regular'>{t('plugin.detailPanel.endpointsEmpty')}</div>
      )}
      <div className='flex flex-col gap-2'>
        {data.endpoints.map((item, index) => (
          <EndpointCard
            key={index}
            data={item}
            handleChange={mutate}
          />
        ))}
      </div>
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas}
          onCancel={hideEndpointModal}
          onSaved={handleCreate}
        />
      )}
    </div>
  )
}

export default EndpointList
