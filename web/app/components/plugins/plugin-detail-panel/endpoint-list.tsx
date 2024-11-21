import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import {
  RiAddLine,
  RiApps2AddLine,
  RiBookOpenLine,
} from '@remixicon/react'
import EndpointModal from './endpoint-modal'
import EndpointCard from './endpoint-card'
import { NAME_FIELD } from './utils'
import { toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ActionButton from '@/app/components/base/action-button'
import Tooltip from '@/app/components/base/tooltip'
import Toast from '@/app/components/base/toast'
import { usePluginPageContext } from '@/app/components/plugins/plugin-page/context'
import {
  useCreateEndpoint,
  useEndpointList,
  useInvalidateEndpointList,
} from '@/service/use-endpoints'
import cn from '@/utils/classnames'

type Props = {
  showTopBorder?: boolean
}
const EndpointList = ({ showTopBorder }: Props) => {
  const { t } = useTranslation()
  const pluginDetail = usePluginPageContext(v => v.currentPluginDetail)
  const pluginUniqueID = pluginDetail.plugin_unique_identifier
  const declaration = pluginDetail.declaration.endpoint
  const { data } = useEndpointList(pluginDetail.plugin_id)
  const invalidateEndpointList = useInvalidateEndpointList()

  const [isShowEndpointModal, {
    setTrue: showEndpointModal,
    setFalse: hideEndpointModal,
  }] = useBoolean(false)

  const formSchemas = useMemo(() => {
    return toolCredentialToFormSchemas([NAME_FIELD, ...declaration.settings])
  }, [declaration.settings])

  const { mutate: createEndpoint } = useCreateEndpoint({
    onSuccess: async () => {
      await invalidateEndpointList(pluginDetail.plugin_id)
      hideEndpointModal()
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    },
  })

  const handleCreate = (state: any) => createEndpoint({
    pluginUniqueID,
    state,
  })

  if (!data)
    return null

  return (
    <div className={cn('px-4 py-2 border-divider-subtle', showTopBorder && 'border-t')}>
      <div className='mb-1 h-6 flex items-center justify-between text-text-secondary system-sm-semibold-uppercase'>
        <div className='flex items-center gap-0.5'>
          {t('plugin.detailPanel.endpoints')}
          <Tooltip
            position='right'
            needsDelay
            popupClassName='w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border'
            popupContent={
              <div className='flex flex-col gap-2'>
                <div className='w-8 h-8 flex items-center justify-center bg-background-default-subtle rounded-lg border-[0.5px] border-components-panel-border-subtle'>
                  <RiApps2AddLine className='w-4 h-4 text-text-tertiary' />
                </div>
                <div className='text-text-tertiary system-xs-regular'>{t('plugin.detailPanel.endpointsTip')}</div>
                {/* TODO  endpoints doc link */}
                <a
                  href=''
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <div className='inline-flex items-center gap-1 text-text-accent system-xs-regular cursor-pointer'>
                    <RiBookOpenLine className='w-3 h-3' />
                    {t('plugin.detailPanel.endpointsDocLink')}
                  </div>
                </a>
              </div>
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
            handleChange={() => invalidateEndpointList(pluginDetail.plugin_id)}
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