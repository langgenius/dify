import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
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
import {
  useCreateEndpoint,
  useEndpointList,
  useInvalidateEndpointList,
} from '@/service/use-endpoints'
import type { PluginDetail } from '@/app/components/plugins/types'
import cn from '@/utils/classnames'

type Props = {
  detail: PluginDetail
}
const EndpointList = ({ detail }: Props) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const pluginUniqueID = detail.plugin_unique_identifier
  const declaration = detail.declaration.endpoint
  const showTopBorder = detail.declaration.tool
  const { data } = useEndpointList(detail.plugin_id)
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
      await invalidateEndpointList(detail.plugin_id)
      hideEndpointModal()
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    },
  })

  const handleCreate = (state: Record<string, any>) => createEndpoint({
    pluginUniqueID,
    state,
  })

  if (!data)
    return null

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      <div className='system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary'>
        <div className='flex items-center gap-0.5'>
          {t('plugin.detailPanel.endpoints')}
          <Tooltip
            position='right'
            popupClassName='w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border'
            popupContent={
              <div className='flex flex-col gap-2'>
                <div className='flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle'>
                  <RiApps2AddLine className='h-4 w-4 text-text-tertiary' />
                </div>
                <div className='system-xs-regular text-text-tertiary'>{t('plugin.detailPanel.endpointsTip')}</div>
                <a
                  href={docLink('/plugins/schema-definition/endpoint')}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <div className='system-xs-regular inline-flex cursor-pointer items-center gap-1 text-text-accent'>
                    <RiBookOpenLine className='h-3 w-3' />
                    {t('plugin.detailPanel.endpointsDocLink')}
                  </div>
                </a>
              </div>
            }
          />
        </div>
        <ActionButton onClick={showEndpointModal}>
          <RiAddLine className='h-4 w-4' />
        </ActionButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className='system-xs-regular mb-1 flex justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary'>{t('plugin.detailPanel.endpointsEmpty')}</div>
      )}
      <div className='flex flex-col gap-2'>
        {data.endpoints.map((item, index) => (
          <EndpointCard
            key={index}
            data={item}
            handleChange={() => invalidateEndpointList(detail.plugin_id)}
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
