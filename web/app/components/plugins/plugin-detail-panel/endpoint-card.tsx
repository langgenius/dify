import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import copy from 'copy-to-clipboard'
import { RiClipboardLine, RiDeleteBinLine, RiEditLine, RiLoginCircleLine } from '@remixicon/react'
import type { EndpointListItem } from '../types'
import EndpointModal from './endpoint-modal'
import { NAME_FIELD } from './utils'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import ActionButton from '@/app/components/base/action-button'
import Confirm from '@/app/components/base/confirm'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import Toast from '@/app/components/base/toast'
import Tooltip from '@/app/components/base/tooltip'
import {
  useDeleteEndpoint,
  useDisableEndpoint,
  useEnableEndpoint,
  useUpdateEndpoint,
} from '@/service/use-endpoints'

type Props = {
  data: EndpointListItem
  handleChange: () => void
}

const EndpointCard = ({
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
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
      setActive(false)
    },
  })
  const { mutate: disableEndpoint } = useDisableEndpoint({
    onSuccess: async () => {
      await handleChange()
      hideDisableConfirm()
    },
    onError: () => {
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
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
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
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
      Toast.notify({ type: 'error', message: t('common.actionMsg.modifiedUnsuccessfully') })
    },
  })
  const handleUpdate = (state: any) => updateEndpoint({
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

  const CopyIcon = isCopied ? ClipboardCheck : RiClipboardLine

  return (
    <div className='p-0.5 bg-background-section-burn rounded-xl'>
      <div className='group p-2.5 pl-3 bg-components-panel-on-panel-item-bg rounded-[10px] border-[0.5px] border-components-panel-border'>
        <div className='flex items-center'>
          <div className='grow mb-1 h-6 flex items-center gap-1 text-text-secondary system-md-semibold'>
            <RiLoginCircleLine className='w-4 h-4' />
            <div>{data.name}</div>
          </div>
          <div className='hidden group-hover:flex items-center'>
            <ActionButton onClick={showEndpointModalConfirm}>
              <RiEditLine className='w-4 h-4' />
            </ActionButton>
            <ActionButton onClick={showDeleteConfirm} className='hover:bg-state-destructive-hover text-text-tertiary hover:text-text-destructive'>
              <RiDeleteBinLine className='w-4 h-4' />
            </ActionButton>
          </div>
        </div>
        {data.declaration.endpoints.map((endpoint, index) => (
          <div key={index} className='h-6 flex items-center'>
            <div className='shrink-0 w-12 text-text-tertiary system-xs-regular'>{endpoint.method}</div>
            <div className='group/item grow flex items-center text-text-secondary system-xs-regular truncate'>
              <div title={`${data.url}${endpoint.path}`} className='truncate'>{`${data.url}${endpoint.path}`}</div>
              <Tooltip popupContent={t(`common.operation.${isCopied ? 'copied' : 'copy'}`)} position='top'>
                <ActionButton className='hidden shrink-0 ml-2 group-hover/item:flex' onClick={() => handleCopy(`${data.url}${endpoint.path}`)}>
                  <CopyIcon className='w-3.5 h-3.5 text-text-tertiary' />
                </ActionButton>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      <div className='p-2 pl-3 flex items-center justify-between'>
        {active && (
          <div className='flex items-center gap-1 system-xs-semibold-uppercase text-util-colors-green-green-600'>
            <Indicator color='green' />
            {t('plugin.detailPanel.serviceOk')}
          </div>
        )}
        {!active && (
          <div className='flex items-center gap-1 system-xs-semibold-uppercase text-text-tertiary'>
            <Indicator color='gray' />
            {t('plugin.detailPanel.disabled')}
          </div>
        )}
        <Switch
          className='ml-3'
          defaultValue={active}
          onChange={handleSwitch}
          size='sm'
        />
      </div>
      {isShowDisableConfirm && (
        <Confirm
          isShow
          title={t('plugin.detailPanel.endpointDisableTip')}
          content={<div>{t('plugin.detailPanel.endpointDisableContent', { name: data.name })}</div>}
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
          title={t('plugin.detailPanel.endpointDeleteTip')}
          content={<div>{t('plugin.detailPanel.endpointDeleteContent', { name: data.name })}</div>}
          onCancel={hideDeleteConfirm}
          onConfirm={() => deleteEndpoint(endpointID)}
        />
      )}
      {isShowEndpointModal && (
        <EndpointModal
          formSchemas={formSchemas}
          defaultValues={formValue}
          onCancel={hideEndpointModalConfirm}
          onSaved={handleUpdate}
        />
      )}
    </div>
  )
}

export default EndpointCard
