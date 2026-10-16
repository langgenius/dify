'use client'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'
import { consoleQuery } from '@/service/console'

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

const MCPServerModal = ({ appID, latestParams = [], data, show, onHide, appInfo }: ModalProps) => {
  const { t } = useTranslation(['common', 'tools'])
  const queryClient = useQueryClient()
  const { mutateAsync: createMCPServer, isPending: creating } = useMutation(
    consoleQuery.apps.byAppId.server.post.mutationOptions(),
  )
  const { mutateAsync: updateMCPServer, isPending: updating } = useMutation(
    consoleQuery.apps.byAppId.server.put.mutationOptions(),
  )
  const invalidateMCPServerDetail = () =>
    queryClient.invalidateQueries({
      queryKey: consoleQuery.apps.byAppId.server.get.queryKey({
        input: { params: { app_id: appID } },
      }),
    })

  const defaultDescription = data?.description || appInfo?.description || ''
  const [description, setDescription] = React.useState(defaultDescription)
  const [params, setParams] = React.useState<Record<string, string>>(data?.parameters || {})

  const handleParamChange = (variable: string, value: string) => {
    setParams((prev) => ({
      ...prev,
      [variable]: value,
    }))
  }

  const getParamValue = () => {
    const res: Record<string, string> = {}
    latestParams.forEach((param) => {
      if (!param.variable) return

      const value = params[param.variable]
      if (value !== undefined) res[param.variable] = value
    })
    return res
  }

  const submit = async () => {
    if (!data) {
      const body: {
        description?: string
        parameters: Record<string, string>
      } = {
        parameters: getParamValue(),
      }

      if (description.trim()) body.description = description

      await createMCPServer({ params: { app_id: appID }, body })
      invalidateMCPServerDetail()
      onHide()
    } else {
      await updateMCPServer({
        params: { app_id: appID },
        body: {
          id: data.id,
          parameters: getParamValue(),
          description,
        },
      })
      invalidateMCPServerDetail()
      onHide()
    }
  }

  return (
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-130">
        <DialogHeader>
          <DialogTitle>
            {!data
              ? t(($) => $['mcp.server.modal.addTitle'], { ns: 'tools' })
              : t(($) => $['mcp.server.modal.editTitle'], { ns: 'tools' })}
          </DialogTitle>
          <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div className="space-y-0.5">
            <div className="flex h-6 items-center gap-1">
              <div className="system-sm-medium text-text-secondary">
                {t(($) => $['mcp.server.modal.description'], { ns: 'tools' })}
              </div>
              <div className="system-xs-regular text-text-destructive-secondary">*</div>
            </div>
            <Textarea
              aria-label={t(($) => $['mcp.server.modal.description'], { ns: 'tools' })}
              className="h-24 resize-none"
              value={description}
              placeholder={t(($) => $['mcp.server.modal.descriptionPlaceholder'], {
                ns: 'tools',
              })}
              onValueChange={(value) => setDescription(value)}
            />
          </div>

          {latestParams.length > 0 && (
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <div className="shrink-0 system-xs-medium-uppercase text-text-primary">
                  {t(($) => $['mcp.server.modal.parameters'], { ns: 'tools' })}
                </div>
                <Separator
                  decorative
                  orientation="horizontal"
                  className="m-0 grow bg-divider-subtle"
                />
              </div>
              <div className="mb-2 body-xs-regular text-text-tertiary">
                {t(($) => $['mcp.server.modal.parametersTip'], { ns: 'tools' })}
              </div>
              <div className="min-w-0 space-y-3">
                {latestParams.map((paramItem) => {
                  if (!paramItem.variable) return null

                  const { variable } = paramItem

                  return (
                    <MCPServerParamItem
                      key={variable}
                      data={paramItem}
                      value={params[variable] || ''}
                      onChange={(value) => handleParamChange(variable, value)}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onHide}>{t(($) => $['mcp.modal.cancel'], { ns: 'tools' })}</Button>
          <Button
            disabled={!description || creating || updating}
            variant="primary"
            onClick={submit}
          >
            {data
              ? t(($) => $['mcp.modal.save'], { ns: 'tools' })
              : t(($) => $['mcp.server.modal.confirm'], { ns: 'tools' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default MCPServerModal
