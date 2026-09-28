import type { EndpointProviderDeclarationResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginDetail } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import EndpointCard from './endpoint-card'
import EndpointModal from './endpoint-modal'

type Props = Readonly<{
  detail: PluginDetail
}>

type EndpointListContentProps = Readonly<{
  declaration: EndpointProviderDeclarationResponse
  detail: PluginDetail
}>

const EndpointListContent = ({ declaration, detail }: EndpointListContentProps) => {
  const { t } = useTranslation(['common', 'plugin'])
  const docLink = useDocLink()
  const pluginUniqueID = detail.plugin_unique_identifier
  const showTopBorder = detail.declaration.tool
  const { data } = useQuery(
    consoleQuery.workspaces.current.endpoints.list.plugin.get.queryOptions({
      input: { query: { plugin_id: detail.plugin_id, page: 1, page_size: 100 } },
    }),
  )
  const [isShowEndpointModal, { setTrue: showEndpointModal, setFalse: hideEndpointModal }] =
    useBoolean(false)
  const showSaveError = () => {
    toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
  }
  const { mutate: createEndpoint, isPending } = useMutation(
    consoleQuery.workspaces.current.endpoints.post.mutationOptions({
      onSuccess: hideEndpointModal,
      onError: showSaveError,
    }),
  )

  if (!data) return null

  return (
    <div className={cn('border-divider-subtle px-4 py-2', showTopBorder && 'border-t')}>
      <div className="mb-1 flex h-6 items-center justify-between system-sm-semibold-uppercase text-text-secondary">
        <div className="flex items-center gap-0.5">
          {t(($) => $['detailPanel.endpoints'], { ns: 'plugin' })}
          <Popover>
            <PopoverTrigger
              openOnHover
              aria-label={t(($) => $['detailPanel.endpointsTip'], { ns: 'plugin' })}
              render={
                <button
                  type="button"
                  className="flex size-4 shrink-0 items-center justify-center rounded-sm p-px outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
                >
                  <span
                    aria-hidden
                    className="i-ri-question-line size-3.5 text-text-quaternary hover:text-text-tertiary"
                  />
                </button>
              }
            />
            <PopoverContent
              placement="right"
              className="w-60 rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-4"
            >
              <div className="flex flex-col gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                  <span aria-hidden className="i-ri-apps-2-add-line size-4 text-text-tertiary" />
                </div>
                <div className="system-xs-regular text-text-tertiary">
                  {t(($) => $['detailPanel.endpointsTip'], { ns: 'plugin' })}
                </div>
                <a
                  href={docLink('/develop-plugin/getting-started/getting-started-dify-plugin')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex cursor-pointer items-center gap-1 system-xs-regular text-text-accent"
                >
                  <span aria-hidden className="i-ri-book-open-line size-3" />
                  {t(($) => $['detailPanel.endpointsDocLink'], { ns: 'plugin' })}
                </a>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <IconButton
          aria-label={t(($) => $['detailPanel.endpointModalTitle'], { ns: 'plugin' })}
          onClick={showEndpointModal}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </IconButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className="mb-1 flex justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">
          {t(($) => $['detailPanel.endpointsEmpty'], { ns: 'plugin' })}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {data.endpoints.map((item) => (
          <EndpointCard key={item.id} data={item} pluginDetail={detail} />
        ))}
      </div>
      {isShowEndpointModal && (
        <EndpointModal
          settings={declaration.settings ?? []}
          onCancel={hideEndpointModal}
          onSaved={(body) =>
            createEndpoint({ body: { ...body, plugin_unique_identifier: pluginUniqueID } })
          }
          isPending={isPending}
          pluginDetail={detail}
        />
      )}
    </div>
  )
}

const EndpointList = ({ detail }: Props) => {
  const declaration = detail.declaration.endpoint
  if (!declaration) return null

  return <EndpointListContent declaration={declaration} detail={detail} />
}

export default EndpointList
