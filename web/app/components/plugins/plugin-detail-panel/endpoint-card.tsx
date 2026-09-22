import type { EndpointListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { PluginDetail } from '../types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import EndpointModal from './endpoint-modal'

type Props = Readonly<{
  pluginDetail: PluginDetail
  data: EndpointListItemResponse
}>

const EndpointCard = ({ pluginDetail, data }: Props) => {
  const { t } = useTranslation()
  const endpointID = data.id
  const [isShowDisableConfirm, { setTrue: showDisableConfirm, setFalse: hideDisableConfirm }] =
    useBoolean(false)
  const [isShowDeleteConfirm, { setTrue: showDeleteConfirm, setFalse: hideDeleteConfirm }] =
    useBoolean(false)
  const [
    isShowEndpointModal,
    { setTrue: showEndpointModalConfirm, setFalse: hideEndpointModalConfirm },
  ] = useBoolean(false)
  const showSaveError = () => {
    toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
  }
  const { mutate: enableEndpoint, isPending: isEnabling } = useMutation(
    consoleQuery.workspaces.current.endpoints.enable.post.mutationOptions({
      onError: showSaveError,
    }),
  )
  const { mutate: disableEndpoint, isPending: isDisabling } = useMutation(
    consoleQuery.workspaces.current.endpoints.disable.post.mutationOptions({
      onSuccess: hideDisableConfirm,
      onError: showSaveError,
    }),
  )
  const { mutate: deleteEndpoint, isPending: isDeleting } = useMutation(
    consoleQuery.workspaces.current.endpoints.byId.delete.mutationOptions({
      onSuccess: hideDeleteConfirm,
      onError: showSaveError,
    }),
  )
  const { mutate: updateEndpoint, isPending: isUpdating } = useMutation(
    consoleQuery.workspaces.current.endpoints.byId.patch.mutationOptions({
      onSuccess: hideEndpointModalConfirm,
      onError: showSaveError,
    }),
  )
  const handleSwitch = (enabled: boolean) => {
    if (enabled) enableEndpoint({ body: { endpoint_id: endpointID } })
    else showDisableConfirm()
  }

  const [isCopied, setIsCopied] = useState(false)
  const handleCopy = (value: string) => {
    copy(value)
    setIsCopied(true)
  }

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => {
        setIsCopied(false)
      }, 2000)
      return () => {
        clearTimeout(timer)
      }
    }
  }, [isCopied])

  const copyLabel = t(($) => $[`operation.${isCopied ? 'copied' : 'copy'}`], { ns: 'common' })

  return (
    <div className="rounded-xl bg-background-section-burn p-0.5">
      <div className="group rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-2.5 pl-3">
        <div className="flex items-center">
          <div className="mb-1 flex h-6 grow items-center gap-1 system-md-semibold text-text-secondary">
            <span aria-hidden className="i-ri-login-circle-line size-4" />
            <div>{data.name}</div>
          </div>
          <div className="flex w-0 items-center overflow-hidden opacity-0 group-hover:w-auto group-hover:overflow-visible group-hover:opacity-100 focus-within:w-auto focus-within:overflow-visible focus-within:opacity-100">
            <IconButton
              aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
              onClick={showEndpointModalConfirm}
            >
              <span aria-hidden className="i-ri-edit-line size-4" />
            </IconButton>
            <IconButton
              aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
              tone="destructive"
              onClick={showDeleteConfirm}
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4" />
            </IconButton>
          </div>
        </div>
        {(data.declaration?.endpoints ?? [])
          .filter((endpoint) => !endpoint.hidden)
          .map((endpoint) => (
            <div key={`${endpoint.method}:${endpoint.path}`} className="flex h-6 items-center">
              <div className="w-12 shrink-0 system-xs-regular text-text-tertiary">
                {endpoint.method}
              </div>
              <div className="group/item flex grow items-center truncate system-xs-regular text-text-secondary">
                <div className="truncate">{`${data.url}${endpoint.path}`}</div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconButton
                        aria-label={copyLabel}
                        className="ml-2 hidden shrink-0 group-hover/item:flex"
                        onClick={() => handleCopy(`${data.url}${endpoint.path}`)}
                      >
                        {isCopied ? (
                          <span
                            aria-hidden
                            className="i-custom-vender-line-files-copy-check size-3.5 text-text-tertiary"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="i-ri-clipboard-line size-3.5 text-text-tertiary"
                          />
                        )}
                      </IconButton>
                    }
                  />
                  <TooltipContent placement="top">{copyLabel}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
      </div>
      <div className="flex items-center justify-between p-2 pl-3">
        {data.enabled && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600">
            <StatusDot status="success" />
            {t(($) => $['detailPanel.serviceOk'], { ns: 'plugin' })}
          </div>
        )}
        {!data.enabled && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary">
            <StatusDot status="disabled" />
            {t(($) => $['detailPanel.disabled'], { ns: 'plugin' })}
          </div>
        )}
        <Switch
          className="ml-3"
          checked={data.enabled}
          onCheckedChange={handleSwitch}
          disabled={isEnabling || isDisabling}
          size="sm"
        />
      </div>
      <AlertDialog
        open={isShowDisableConfirm}
        onOpenChange={(open) => !open && hideDisableConfirm()}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['detailPanel.endpointDisableTip'], { ns: 'plugin' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['detailPanel.endpointDisableContent'], { ns: 'plugin', name: data.name })}
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={isDisabling}
              onClick={() => disableEndpoint({ body: { endpoint_id: endpointID } })}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={(open) => !open && hideDeleteConfirm()}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t(($) => $['detailPanel.endpointDeleteTip'], { ns: 'plugin' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t(($) => $['detailPanel.endpointDeleteContent'], { ns: 'plugin', name: data.name })}
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={isDeleting}
              onClick={() => deleteEndpoint({ params: { id: endpointID } })}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {isShowEndpointModal && (
        <EndpointModal
          settings={data.declaration?.settings ?? []}
          defaultValues={{ ...data.settings, name: data.name }}
          onCancel={hideEndpointModalConfirm}
          onSaved={(body) => updateEndpoint({ params: { id: endpointID }, body })}
          isPending={isUpdating}
          pluginDetail={pluginDetail}
        />
      )}
    </div>
  )
}

export default EndpointCard
