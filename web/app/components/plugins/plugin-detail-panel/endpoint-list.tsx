import type { PluginDetail } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
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
import { toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { useDocLink } from '@/context/i18n'
import {
  useCreateEndpoint,
  useEndpointList,
  useInvalidateEndpointList,
} from '@/service/use-endpoints'
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
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
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
      <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
        <div className="flex items-center gap-0.5">
          {t('detailPanel.endpoints', { ns: 'plugin' })}
          <Popover>
            <PopoverTrigger
              openOnHover
              aria-label={t('detailPanel.endpointsTip', { ns: 'plugin' })}
              render={(
                <button
                  type="button"
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm p-px outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                >
                  <span aria-hidden className="i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary" />
                </button>
              )}
            />
            <PopoverContent
              placement="right"
              popupClassName="w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border"
            >
              <div className="flex flex-col gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                  <RiApps2AddLine className="h-4 w-4 text-text-tertiary" />
                </div>
                <div className="system-xs-regular text-text-tertiary">{t('detailPanel.endpointsTip', { ns: 'plugin' })}</div>
                <a
                  href={docLink('/develop-plugin/getting-started/getting-started-dify-plugin')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex cursor-pointer items-center gap-1 system-xs-regular text-text-accent"
                >
                  <RiBookOpenLine className="h-3 w-3" />
                  {t('detailPanel.endpointsDocLink', { ns: 'plugin' })}
                </a>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <ActionButton
          aria-label={t('detailPanel.endpointModalTitle', { ns: 'plugin' })}
          onClick={showEndpointModal}
        >
          <RiAddLine className="h-4 w-4" />
        </ActionButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className="mb-1 flex justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">{t('detailPanel.endpointsEmpty', { ns: 'plugin' })}</div>
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
