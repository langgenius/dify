import type { EndpointListItemResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { PluginDetail } from '../types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useMutation } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { addDefaultValue } from '@/app/components/tools/utils/to-form-schema'
import { consoleQuery } from '@/service/client'
import EndpointModal from './endpoint-modal'
import { endpointSettingsToFormSchemas, NAME_FIELD } from './utils'

type EndpointModalFormSchemas = ComponentProps<typeof EndpointModal>['formSchemas']
type EndpointData = EndpointListItemResponse & {
  declaration: NonNullable<EndpointListItemResponse['declaration']>
}

type Props = Readonly<{
  pluginDetail: PluginDetail
  data: EndpointData
  handleChange: () => void
}>

const EndpointCard = ({ pluginDetail, data, handleChange }: Props) => {
  const { t } = useTranslation()
  const [active, setActive] = useState(data.enabled)
  const endpointID = data.id

  // switch
  const [isShowDisableConfirm, { setTrue: showDisableConfirm, setFalse: hideDisableConfirm }] =
    useBoolean(false)
  const { mutate: enableEndpoint } = useMutation(
    consoleQuery.workspaces.current.endpoints.enable.post.mutationOptions({
      onSuccess: async () => {
        await handleChange()
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        setActive(false)
      },
    }),
  )
  const { mutate: disableEndpoint } = useMutation(
    consoleQuery.workspaces.current.endpoints.disable.post.mutationOptions({
      onSuccess: async () => {
        await handleChange()
        hideDisableConfirm()
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        setActive(false)
      },
    }),
  )
  const handleSwitch = (state: boolean) => {
    if (state) {
      setActive(true)
      enableEndpoint({ body: { endpoint_id: endpointID } })
    } else {
      setActive(false)
      showDisableConfirm()
    }
  }

  // delete
  const [isShowDeleteConfirm, { setTrue: showDeleteConfirm, setFalse: hideDeleteConfirm }] =
    useBoolean(false)
  const { mutate: deleteEndpoint } = useMutation(
    consoleQuery.workspaces.current.endpoints.byId.delete.mutationOptions({
      onSuccess: async () => {
        await handleChange()
        hideDeleteConfirm()
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )

  // update
  const [
    isShowEndpointModal,
    { setTrue: showEndpointModalConfirm, setFalse: hideEndpointModalConfirm },
  ] = useBoolean(false)
  const formSchemas = useMemo(() => {
    return [NAME_FIELD, ...endpointSettingsToFormSchemas(data.declaration.settings ?? [])]
  }, [data.declaration.settings])
  const formValue = useMemo(() => {
    const formValue = {
      name: data.name,
      ...data.settings,
    }
    return addDefaultValue(formValue, formSchemas)
  }, [data.name, data.settings, formSchemas])
  const { mutate: updateEndpoint } = useMutation(
    consoleQuery.workspaces.current.endpoints.byId.patch.mutationOptions({
      onSuccess: async () => {
        await handleChange()
        hideEndpointModalConfirm()
      },
      onError: () => {
        toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
      },
    }),
  )
  const handleUpdate = (state: Record<string, unknown>) => {
    const { name, ...settings } = state
    if (typeof name !== 'string') return

    updateEndpoint({
      params: { id: endpointID },
      body: { name, settings },
    })
  }

  const [isCopied, setIsCopied] = useState(false)
  const handleCopy = (value: string) => {
    copy(value)
    setIsCopied(true)
  }

  const handleDisableConfirmOpenChange = (open: boolean) => {
    if (open) return

    hideDisableConfirm()
    setActive(true)
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
          <div className="hidden items-center group-hover:flex">
            <ActionButton
              aria-label={t(($) => $['operation.edit'], { ns: 'common' })}
              onClick={showEndpointModalConfirm}
            >
              <span aria-hidden className="i-ri-edit-line size-4" />
            </ActionButton>
            <ActionButton
              aria-label={t(($) => $['operation.delete'], { ns: 'common' })}
              onClick={showDeleteConfirm}
              className="text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive"
            >
              <span aria-hidden className="i-ri-delete-bin-line size-4" />
            </ActionButton>
          </div>
        </div>
        {(data.declaration.endpoints ?? [])
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
                      <ActionButton
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
                      </ActionButton>
                    }
                  />
                  <TooltipContent placement="top">{copyLabel}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          ))}
      </div>
      <div className="flex items-center justify-between p-2 pl-3">
        {active && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600">
            <StatusDot status="success" />
            {t(($) => $['detailPanel.serviceOk'], { ns: 'plugin' })}
          </div>
        )}
        {!active && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary">
            <StatusDot status="disabled" />
            {t(($) => $['detailPanel.disabled'], { ns: 'plugin' })}
          </div>
        )}
        <Switch className="ml-3" checked={active} onCheckedChange={handleSwitch} size="sm" />
      </div>
      <AlertDialog open={isShowDisableConfirm} onOpenChange={handleDisableConfirmOpenChange}>
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
              onClick={() => deleteEndpoint({ params: { id: endpointID } })}
            >
              {t(($) => $['operation.confirm'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas as EndpointModalFormSchemas}
          defaultValues={formValue}
          onCancel={hideEndpointModalConfirm}
          onSaved={handleUpdate}
          pluginDetail={pluginDetail}
        />
      )}
    </div>
  )
}

export default EndpointCard
