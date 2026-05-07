import type { ComponentProps } from 'react'
import type { EndpointListItem, PluginDetail } from '../types'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Switch } from '@langgenius/dify-ui/switch'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { CopyCheck } from '@/app/components/base/icons/src/vender/line/files'
import Indicator from '@/app/components/header/indicator'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import {
  useDeleteEndpoint,
  useDisableEndpoint,
  useEnableEndpoint,
  useUpdateEndpoint,
} from '@/service/use-endpoints'
import EndpointModal from './endpoint-modal'
import { NAME_FIELD } from './utils'

type EndpointModalFormSchemas = ComponentProps<typeof EndpointModal>['formSchemas']

type Props = {
  pluginDetail: PluginDetail
  data: EndpointListItem
  handleChange: () => void
}

const EndpointCard = ({
  pluginDetail,
  data,
  handleChange,
}: Props) => {
  const { t } = useTranslation()
  const [active, setActive] = useState(data.enabled)
  const endpointID = data.id

  // switch
  const [isShowDisableConfirm, {
    setTrue: showDisableConfirm,
    setFalse: hideDisableConfirm,
  }] = useBoolean(false)
  const { mutate: enableEndpoint } = useEnableEndpoint({
    onSuccess: async () => {
      await handleChange()
    },
    onError: () => {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      setActive(false)
    },
  })
  const { mutate: disableEndpoint } = useDisableEndpoint({
    onSuccess: async () => {
      await handleChange()
      hideDisableConfirm()
    },
    onError: () => {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
      setActive(false)
    },
  })
  const handleSwitch = (state: boolean) => {
    if (state) {
      setActive(true)
      enableEndpoint(endpointID)
    }
    else {
      setActive(false)
      showDisableConfirm()
    }
  }

  // delete
  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const { mutate: deleteEndpoint } = useDeleteEndpoint({
    onSuccess: async () => {
      await handleChange()
      hideDeleteConfirm()
    },
    onError: () => {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    },
  })

  // update
  const [isShowEndpointModal, {
    setTrue: showEndpointModalConfirm,
    setFalse: hideEndpointModalConfirm,
  }] = useBoolean(false)
  const formSchemas = useMemo(() => {
    return toolCredentialToFormSchemas([NAME_FIELD, ...data.declaration.settings])
  }, [data.declaration.settings])
  const formValue = useMemo(() => {
    const formValue = {
      name: data.name,
      ...data.settings,
    }
    return addDefaultValue(formValue, formSchemas)
  }, [data.name, data.settings, formSchemas])
  const { mutate: updateEndpoint } = useUpdateEndpoint({
    onSuccess: async () => {
      await handleChange()
      hideEndpointModalConfirm()
    },
    onError: () => {
      toast.error(t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }))
    },
  })
  const handleUpdate = (state: Record<string, unknown>) => updateEndpoint({
    endpointID,
    state,
  })

  const [isCopied, setIsCopied] = useState(false)
  const handleCopy = (value: string) => {
    copy(value)
    setIsCopied(true)
  }

  const handleDisableConfirmOpenChange = (open: boolean) => {
    if (open)
      return

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

  const copyLabel = t(`operation.${isCopied ? 'copied' : 'copy'}`, { ns: 'common' })

  return (
    <div className="rounded-xl bg-background-section-burn p-0.5">
      <div className="group rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-2.5 pl-3">
        <div className="flex items-center">
          <div className="mb-1 flex h-6 grow items-center gap-1 system-md-semibold text-text-secondary">
            <span aria-hidden className="i-ri-login-circle-line h-4 w-4" />
            <div>{data.name}</div>
          </div>
          <div className="hidden items-center group-hover:flex">
            <ActionButton onClick={showEndpointModalConfirm}>
              <span aria-hidden className="i-ri-edit-line h-4 w-4" />
            </ActionButton>
            <ActionButton onClick={showDeleteConfirm} className="text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive">
              <span aria-hidden className="i-ri-delete-bin-line h-4 w-4" />
            </ActionButton>
          </div>
        </div>
        {data.declaration.endpoints.filter(endpoint => !endpoint.hidden).map((endpoint, index) => (
          <div key={index} className="flex h-6 items-center">
            <div className="w-12 shrink-0 system-xs-regular text-text-tertiary">{endpoint.method}</div>
            <div className="group/item flex grow items-center truncate system-xs-regular text-text-secondary">
              <div title={`${data.url}${endpoint.path}`} className="truncate">{`${data.url}${endpoint.path}`}</div>
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <ActionButton
                      aria-label={copyLabel}
                      className="ml-2 hidden shrink-0 group-hover/item:flex"
                      onClick={() => handleCopy(`${data.url}${endpoint.path}`)}
                    >
                      {isCopied
                        ? <CopyCheck aria-hidden className="h-3.5 w-3.5 text-text-tertiary" />
                        : <span aria-hidden className="i-ri-clipboard-line h-3.5 w-3.5 text-text-tertiary" />}
                    </ActionButton>
                  )}
                />
                <TooltipContent placement="top">
                  {copyLabel}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between p-2 pl-3">
        {active && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600">
            <Indicator color="green" />
            {t('detailPanel.serviceOk', { ns: 'plugin' })}
          </div>
        )}
        {!active && (
          <div className="flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary">
            <Indicator color="gray" />
            {t('detailPanel.disabled', { ns: 'plugin' })}
          </div>
        )}
        <Switch
          className="ml-3"
          checked={active}
          onCheckedChange={handleSwitch}
          size="sm"
        />
      </div>
      <AlertDialog
        open={isShowDisableConfirm}
        onOpenChange={handleDisableConfirmOpenChange}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('detailPanel.endpointDisableTip', { ns: 'plugin' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('detailPanel.endpointDisableContent', { ns: 'plugin', name: data.name })}
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {t('operation.cancel', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => disableEndpoint(endpointID)}>
              {t('operation.confirm', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={isShowDeleteConfirm} onOpenChange={open => !open && hideDeleteConfirm()}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('detailPanel.endpointDeleteTip', { ns: 'plugin' })}
            </AlertDialogTitle>
            <div className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('detailPanel.endpointDeleteContent', { ns: 'plugin', name: data.name })}
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton onClick={() => deleteEndpoint(endpointID)}>
              {t('operation.confirm', { ns: 'common' })}
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
