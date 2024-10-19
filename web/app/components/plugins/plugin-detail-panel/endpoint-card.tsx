import React, { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBoolean } from 'ahooks'
import { RiDeleteBinLine, RiEditLine, RiLoginCircleLine } from '@remixicon/react'
import type { EndpointListItem } from '../types'
import EndpointModal from './endpoint-modal'
import { addDefaultValue, toolCredentialToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import ActionButton from '@/app/components/base/action-button'
import CopyBtn from '@/app/components/base/copy-btn'
import Confirm from '@/app/components/base/confirm'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import {
  deleteEndpoint,
  disableEndpoint,
  enableEndpoint,
  updateEndpoint,
} from '@/service/plugins'

type Props = {
  data: EndpointListItem
}

const EndpointCard = ({
  data,
}: Props) => {
  const { t } = useTranslation()
  const [active, setActive] = useState(data.enabled)
  const endpointID = data.id

  const [isShowDisableConfirm, {
    setTrue: showDisableConfirm,
    setFalse: hideDisableConfirm,
  }] = useBoolean(false)
  const activeEndpoint = async () => {
    try {
      await enableEndpoint({
        url: '/workspaces/current/endpoints/enable',
        endpointID,
      })
    }
    catch (error) {
      console.error(error)
      setActive(false)
    }
  }
  const inactiveEndpoint = async () => {
    try {
      await disableEndpoint({
        url: '/workspaces/current/endpoints/disable',
        endpointID,
      })
    }
    catch (error) {
      console.error(error)
      setActive(true)
    }
  }
  const handleSwitch = (state: boolean) => {
    if (state) {
      setActive(true)
      activeEndpoint()
    }
    else {
      setActive(false)
      showDisableConfirm()
    }
  }

  const [isShowDeleteConfirm, {
    setTrue: showDeleteConfirm,
    setFalse: hideDeleteConfirm,
  }] = useBoolean(false)
  const handleDelete = async () => {
    try {
      await deleteEndpoint({
        url: '/workspaces/current/endpoints/delete',
        endpointID,
      })
    }
    catch (error) {
      console.error(error)
    }
  }

  const [isShowEndpointModal, {
    setTrue: showEndpointModalConfirm,
    setFalse: hideEndpointModalConfirm,
  }] = useBoolean(false)

  const formSchemas = useMemo(() => {
    return toolCredentialToFormSchemas(data.declaration.settings)
  }, [data.declaration.settings])
  const formValue = useMemo(() => {
    return addDefaultValue(data.settings, formSchemas)
  }, [data.settings, formSchemas])

  const handleUpdate = (state: any) => {
    try {
      updateEndpoint({
        url: '/workspaces/current/endpoints',
        body: {
          endpoint_id: data.id,
          settings: state,
          name: state.name,
        },
      })
    }
    catch (error) {
      console.error(error)
    }
  }

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
              <CopyBtn
                className='hidden shrink-0 ml-2 group-hover/item:block'
                value={`${data.url}${endpoint.path}`}
                isPlain
              />
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
          onConfirm={inactiveEndpoint}
        />
      )}
      {isShowDeleteConfirm && (
        <Confirm
          isShow
          title={t('plugin.detailPanel.endpointDeleteTip')}
          content={<div>{t('plugin.detailPanel.endpointDeleteContent', { name: data.name })}</div>}
          onCancel={hideDeleteConfirm}
          onConfirm={handleDelete}
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
