'use client'
import type {
  MCPServerDetail,
} from '@/app/components/tools/types'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'
import {
  useCreateMCPServer,
  useInvalidateMCPServerDetail,
  useUpdateMCPServer,
} from '@/service/use-tools'
import { cn } from '@/utils/classnames'

export type ModalProps = {
  appID: string
  latestParams?: any[]
  data?: MCPServerDetail
  show: boolean
  onHide: () => void
  appInfo?: any
}

const MCPServerModal = ({
  appID,
  latestParams = [],
  data,
  show,
  onHide,
  appInfo,
}: ModalProps) => {
  const { t } = useTranslation()
  const { mutateAsync: createMCPServer, isPending: creating } = useCreateMCPServer()
  const { mutateAsync: updateMCPServer, isPending: updating } = useUpdateMCPServer()
  const invalidateMCPServerDetail = useInvalidateMCPServerDetail()

  const defaultDescription = data?.description || appInfo?.description || ''
  const [description, setDescription] = React.useState(defaultDescription)
  const [params, setParams] = React.useState(data?.parameters || {})

  const handleParamChange = (variable: string, value: string) => {
    setParams(prev => ({
      ...prev,
      [variable]: value,
    }))
  }

  const getParamValue = () => {
    const res = {} as any
    latestParams.map((param) => {
      res[param.variable] = params[param.variable]
      return param
    })
    return res
  }

  const submit = async () => {
    if (!data) {
      const payload: any = {
        appID,
        parameters: getParamValue(),
      }

      if (description.trim())
        payload.description = description

      await createMCPServer(payload)
      invalidateMCPServerDetail(appID)
      onHide()
    }
    else {
      const payload: any = {
        appID,
        id: data.id,
        parameters: getParamValue(),
      }

      payload.description = description
      await updateMCPServer(payload)
      invalidateMCPServerDetail(appID)
      onHide()
    }
  }

  return (
    <Modal
      isShow={show}
      onClose={onHide}
      className={cn('relative !max-w-[520px] !p-0')}
    >
      <div className="absolute right-5 top-5 z-10 cursor-pointer p-1.5" onClick={onHide}>
        <RiCloseLine className="h-5 w-5 text-text-tertiary" />
      </div>
      <div className="title-2xl-semi-bold relative p-6 pb-3 text-xl text-text-primary">
        {!data ? t('mcp.server.modal.addTitle', { ns: 'tools' }) : t('mcp.server.modal.editTitle', { ns: 'tools' })}
      </div>
      <div className="space-y-5 px-6 py-3">
        <div className="space-y-0.5">
          <div className="flex h-6 items-center gap-1">
            <div className="system-sm-medium text-text-secondary">{t('mcp.server.modal.description', { ns: 'tools' })}</div>
            <div className="system-xs-regular text-text-destructive-secondary">*</div>
          </div>
          <Textarea
            className="h-[96px] resize-none"
            value={description}
            placeholder={t('mcp.server.modal.descriptionPlaceholder', { ns: 'tools' })}
            onChange={e => setDescription(e.target.value)}
          >
          </Textarea>
        </div>
        {latestParams.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="system-xs-medium-uppercase shrink-0 text-text-primary">{t('mcp.server.modal.parameters', { ns: 'tools' })}</div>
              <Divider type="horizontal" className="!m-0 !h-px grow bg-divider-subtle" />
            </div>
            <div className="body-xs-regular mb-2 text-text-tertiary">{t('mcp.server.modal.parametersTip', { ns: 'tools' })}</div>
            <div className="space-y-3">
              {latestParams.map(paramItem => (
                <MCPServerParamItem
                  key={paramItem.variable}
                  data={paramItem}
                  value={params[paramItem.variable] || ''}
                  onChange={value => handleParamChange(paramItem.variable, value)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-row-reverse p-6 pt-5">
        <Button disabled={!description || creating || updating} className="ml-2" variant="primary" onClick={submit}>{data ? t('mcp.modal.save', { ns: 'tools' }) : t('mcp.server.modal.confirm', { ns: 'tools' })}</Button>
        <Button onClick={onHide}>{t('mcp.modal.cancel', { ns: 'tools' })}</Button>
      </div>
    </Modal>
  )
}

export default MCPServerModal
