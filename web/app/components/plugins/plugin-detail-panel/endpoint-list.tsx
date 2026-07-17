import type { PluginDetail } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/client'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import EndpointCard from './endpoint-card'
import EndpointModal from './endpoint-modal'
import { endpointPluginSettingsToFormSchemas, NAME_FIELD } from './utils'

type Props = Readonly<{
  detail: PluginDetail
}>

type EndpointDeclaration = NonNullable<PluginDetail['declaration']['endpoint']>

type EndpointListContentProps = Readonly<{
  declaration: EndpointDeclaration
  detail: PluginDetail
}>

const EndpointListContent = ({ declaration, detail }: EndpointListContentProps) => {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const queryClient = useQueryClient()
  const pluginUniqueID = detail.plugin_unique_identifier
  const showTopBorder = detail.declaration.tool
  const endpointListQueryOptions =
    consoleQuery.workspaces.current.endpoints.list.plugin.get.queryOptions({
      input: {
        query: {
          plugin_id: detail.plugin_id,
          page: 1,
          page_size: 100,
        },
      },
    })
  const { data } = useQuery(endpointListQueryOptions)
  const invalidateEndpointList = () =>
    queryClient.invalidateQueries({ queryKey: endpointListQueryOptions.queryKey })
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()

  const [isShowEndpointModal, { setTrue: showEndpointModal, setFalse: hideEndpointModal }] =
    useBoolean(false)

  const formSchemas = useMemo(() => {
    return [NAME_FIELD, ...endpointPluginSettingsToFormSchemas(declaration.settings)]
  }, [declaration.settings])

  const { mutate: createEndpoint } = useMutation(
    consoleQuery.workspaces.current.endpoints.post.mutationOptions({
      onSuccess: async () => {
        await invalidateEndpointList()
        invalidateInstalledPluginList()
        hideEndpointModal()
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )

  const handleCreate = (state: Record<string, unknown>) => {
    const { name, ...settings } = state
    if (typeof name !== 'string') return

    createEndpoint({
      body: {
        plugin_unique_identifier: pluginUniqueID,
        name,
        settings,
      },
    })
  }

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
              popupClassName="w-[240px] p-4 rounded-xl bg-components-panel-bg-blur border-[0.5px] border-components-panel-border"
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
        <ActionButton
          aria-label={t(($) => $['detailPanel.endpointModalTitle'], { ns: 'plugin' })}
          onClick={showEndpointModal}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
        </ActionButton>
      </div>
      {data.endpoints.length === 0 && (
        <div className="mb-1 flex justify-center rounded-[10px] bg-background-section p-3 system-xs-regular text-text-tertiary">
          {t(($) => $['detailPanel.endpointsEmpty'], { ns: 'plugin' })}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {data.endpoints.map((item) =>
          item.declaration ? (
            <EndpointCard
              key={item.id}
              data={{ ...item, declaration: item.declaration }}
              handleChange={() => {
                void invalidateEndpointList()
                invalidateInstalledPluginList()
              }}
              pluginDetail={detail}
            />
          ) : null,
        )}
      </div>
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas}
          onCancel={hideEndpointModal}
          onSaved={handleCreate}
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
