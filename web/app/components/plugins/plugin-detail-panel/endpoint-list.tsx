import type { PluginDetail } from '@/app/components/plugins/types'
import {
  RiAddLine,
  RiApps2AddLine,
  RiBookOpenLine,
} from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import { toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { useDocLink } from '@/context/i18n'
import {
  useCreateEndpoint,
  useEndpointList,
  useInvalidateEndpointList,
} from '@/service/use-endpoints'
import { cn } from '@/utils/classnames'
import EndpointCard from './endpoint-card'
import EndpointModal from './endpoint-modal'
import { NAME_FIELD } from './utils'

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
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
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
      <div className="system-sm-semibold-uppercase mb-1 flex h-6 items-center justify-between text-text-secondary">
        <div className="flex items-center gap-0.5">
          {t('detailPanel.endpoints', { ns: 'plugin' })}
          <Tooltip
            position="right"
            popupClassName="w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border"
            popupContent={(
              <div className="flex flex-col gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                  <RiApps2AddLine className="h-4 w-4 text-text-tertiary" />
                </div>
                <div className="system-xs-regular text-text-tertiary">{t('detailPanel.endpointsTip', { ns: 'plugin' })}</div>
                <a
                  href={docLink('/develop-plugin/getting-started/getting-started-dify-plugin')}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="system-xs-regular inline-flex cursor-pointer items-center gap-1 text-text-accent">
                    <RiBookOpenLine className="h-3 w-3" />
                    {t('detailPanel.endpointsDocLink', { ns: 'plugin' })}
                  </div>
                </a>
              </div>
            )}
          />
        </div>
        <ActionButton onClick={showEndpointModal}>
          <RiAddLine className="h-4 w-4" />
        </ActionButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className="system-xs-regular mb-1 flex justify-center rounded-[10px] bg-background-section p-3 text-text-tertiary">{t('detailPanel.endpointsEmpty', { ns: 'plugin' })}</div>
      )}
      <div className="flex flex-col gap-2">
        {data.endpoints.map((item, index) => (
          <EndpointCard
            key={index}
            data={item}
            handleChange={() => invalidateEndpointList(detail.plugin_id)}
            pluginDetail={detail}
          />
        ))}
      </div>
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas as any}
          onCancel={hideEndpointModal}
          onSaved={handleCreate}
          pluginDetail={detail}
        />
      )}
    </div>
  )
}

export default EndpointList
