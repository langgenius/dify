'use client'
import type {
  MCPServerDetail,
} from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Textarea from '@/app/components/base/textarea'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'
import { webSocketClient } from '@/app/components/workflow/collaboration/core/websocket-manager'
import {
  useCreateMCPServer,
  useInvalidateMCPServerDetail,
  useUpdateMCPServer,
} from '@/service/use-tools'

type ModalProps = {
  appID: string
  latestParams?: MCPServerParam[]
  data?: MCPServerDetail
  show: boolean
  onHide: () => void
  appInfo?: {
    description?: string
  }
}

type MCPServerParam = {
  variable?: string
  label?: string
  type?: string
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
  const [params, setParams] = React.useState<Record<string, string>>(data?.parameters || {})

  const handleParamChange = (variable: string, value: string) => {
    setParams(prev => ({
      ...prev,
      [variable]: value,
    }))
  }

  const getParamValue = () => {
    const res: Record<string, string> = {}
    latestParams.forEach((param) => {
      if (!param.variable)
        return

      const value = params[param.variable]
      if (value !== undefined)
        res[param.variable] = value
    })
    return res
  }

  const emitMcpServerUpdate = (action: 'created' | 'updated') => {
    const socket = webSocketClient.getSocket(appID)
    if (!socket)
      return

    const timestamp = Date.now()
    socket.emit('collaboration_event', {
      type: 'mcp_server_update',
      data: {
        action,
        timestamp,
      },
      timestamp,
    })
  }

  const submit = async () => {
    if (!data) {
      const payload: {
        appID: string
        description?: string
        parameters: Record<string, string>
      } = {
        appID,
        parameters: getParamValue(),
      }

      if (description.trim())
        payload.description = description

      await createMCPServer(payload)
      invalidateMCPServerDetail(appID)
      emitMcpServerUpdate('created')
      onHide()
    }
    else {
      const payload: {
        appID: string
        id: string
        description: string
        parameters: Record<string, string>
      } = {
        appID,
        id: data.id,
        parameters: getParamValue(),
        description,
      }

      await updateMCPServer(payload)
      invalidateMCPServerDetail(appID)
      emitMcpServerUpdate('updated')
      onHide()
    }
  }

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[520px]! overflow-hidden! border-none p-0! text-left align-middle transition-all duration-100 ease-in">
        <button
          type="button"
          aria-label={t('operation.close', { ns: 'common' })}
          className="absolute top-5 right-5 z-10 cursor-pointer border-none bg-transparent p-1.5 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={onHide}
        >
          <RiCloseLine className="h-5 w-5 text-text-tertiary" aria-hidden="true" />
        </button>
        <div className="relative p-6 pb-3 title-2xl-semi-bold text-xl text-text-primary">
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
                <div className="shrink-0 system-xs-medium-uppercase text-text-primary">{t('mcp.server.modal.parameters', { ns: 'tools' })}</div>
                <Divider type="horizontal" className="m-0! h-px! grow bg-divider-subtle" />
              </div>
              <div className="mb-2 body-xs-regular text-text-tertiary">{t('mcp.server.modal.parametersTip', { ns: 'tools' })}</div>
              <div className="space-y-3">
                {latestParams.map((paramItem) => {
                  if (!paramItem.variable)
                    return null

                  const { variable } = paramItem

                  return (
                    <MCPServerParamItem
                      key={variable}
                      data={paramItem}
                      value={params[variable] || ''}
                      onChange={value => handleParamChange(variable, value)}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-row-reverse p-6 pt-5">
          <Button disabled={!description || creating || updating} className="ml-2" variant="primary" onClick={submit}>{data ? t('mcp.modal.save', { ns: 'tools' }) : t('mcp.server.modal.confirm', { ns: 'tools' })}</Button>
          <Button onClick={onHide}>{t('mcp.modal.cancel', { ns: 'tools' })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default MCPServerModal
