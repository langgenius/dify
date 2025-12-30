import type { EndpointListItem, PluginDetail } from '../types'
import { RiClipboardLine, RiDeleteBinLine, RiEditLine, RiLoginCircleLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import { CopyCheck } from '@/app/components/base/icons/src/vender/line/files'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
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
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
      setActive(false)
    },
  })
  const { mutate: disableEndpoint } = useDisableEndpoint({
    onSuccess: async () => {
      await handleChange()
      hideDisableConfirm()
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
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
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
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
      Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
    },
  })
  const handleUpdate = (state: Record<string, any>) => updateEndpoint({
    endpointID,
    state,
  })

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

  const CopyIcon = isCopied ? CopyCheck : RiClipboardLine

  return (
    <div className="rounded-xl bg-background-section-burn p-0.5">
      <div className="group rounded-[10px] border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-2.5 pl-3">
        <div className="flex items-center">
          <div className="system-md-semibold mb-1 flex h-6 grow items-center gap-1 text-text-secondary">
            <RiLoginCircleLine className="h-4 w-4" />
            <div>{data.name}</div>
          </div>
          <div className="hidden items-center group-hover:flex">
            <ActionButton onClick={showEndpointModalConfirm}>
              <RiEditLine className="h-4 w-4" />
            </ActionButton>
            <ActionButton onClick={showDeleteConfirm} className="text-text-tertiary hover:bg-state-destructive-hover hover:text-text-destructive">
              <RiDeleteBinLine className="h-4 w-4" />
            </ActionButton>
          </div>
        </div>
        {data.declaration.endpoints.filter(endpoint => !endpoint.hidden).map((endpoint, index) => (
          <div key={index} className="flex h-6 items-center">
            <div className="system-xs-regular w-12 shrink-0 text-text-tertiary">{endpoint.method}</div>
            <div className="group/item system-xs-regular flex grow items-center truncate text-text-secondary">
              <div title={`${data.url}${endpoint.path}`} className="truncate">{`${data.url}${endpoint.path}`}</div>
              <Tooltip popupContent={t(`operation.${isCopied ? 'copied' : 'copy'}`, { ns: 'common' })} position="top">
                <ActionButton className="ml-2 hidden shrink-0 group-hover/item:flex" onClick={() => handleCopy(`${data.url}${endpoint.path}`)}>
                  <CopyIcon className="h-3.5 w-3.5 text-text-tertiary" />
                </ActionButton>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between p-2 pl-3">
        {active && (
          <div className="system-xs-semibold-uppercase flex items-center gap-1 text-util-colors-green-green-600">
            <Indicator color="green" />
            {t('detailPanel.serviceOk', { ns: 'plugin' })}
          </div>
        )}
        {!active && (
          <div className="system-xs-semibold-uppercase flex items-center gap-1 text-text-tertiary">
            <Indicator color="gray" />
            {t('detailPanel.disabled', { ns: 'plugin' })}
          </div>
        )}
        <Switch
          className="ml-3"
          defaultValue={active}
          onChange={handleSwitch}
          size="sm"
        />
      </div>
      {isShowDisableConfirm && (
        <Confirm
          isShow
          title={t('detailPanel.endpointDisableTip', { ns: 'plugin' })}
          content={<div>{t('detailPanel.endpointDisableContent', { ns: 'plugin', name: data.name })}</div>}
          onCancel={() => {
            hideDisableConfirm()
            setActive(true)
          }}
          onConfirm={() => disableEndpoint(endpointID)}
        />
      )}
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t('detailPanel.endpointDeleteTip', { ns: 'plugin' })}
          content={<div>{t('detailPanel.endpointDeleteContent', { ns: 'plugin', name: data.name })}</div>}
          onCancel={hideDeleteConfirm}
          onConfirm={() => deleteEndpoint(endpointID)}
        />
      )}
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas as any}
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
