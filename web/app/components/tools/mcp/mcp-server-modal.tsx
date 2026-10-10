'use client'
import type { MCPServerParam } from './mcp-server-param-item'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { RiCloseLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MCPServerParamItem } from '@/app/components/tools/mcp/mcp-server-param-item'
import {
  useCreateMCPServer,
  useInvalidateMCPServerDetail,
  useUpdateMCPServer,
} from '@/service/use-tools'

type ModalProps = {
  appID: string
  latestParams?: MCPServerParam[]
  data?: MCPServerDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  appInfo?: {
    description?: string
  }
}

type MCPServerValues = {
  description: string
  parameters: Record<string, string>
}

function MCPServerForm({
  latestParams = [],
  data,
  appInfo,
  isPending,
  onSubmit,
}: Pick<ModalProps, 'latestParams' | 'data' | 'appInfo'> & {
  isPending: boolean
  onSubmit: (values: MCPServerValues) => Promise<void>
}) {
  const { t } = useTranslation(['common', 'tools'])
  const [isEditing] = useState(() => Boolean(data))
  const [description, setDescription] = useState(
    () => data?.description || appInfo?.description || '',
  )
  const [params, setParams] = useState<Record<string, string>>(() => data?.parameters || {})

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

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        if (isPending || !description) return
        void onSubmit({ description, parameters: getParamValue() })
      }}
    >
      <DialogClose
        disabled={isPending}
        aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        className="absolute top-5 right-5 z-10 cursor-pointer border-none bg-transparent p-1.5 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
      >
        <RiCloseLine className="size-5 text-text-tertiary" aria-hidden="true" />
      </DialogClose>
      <DialogTitle className="relative shrink-0 p-6 pr-12 pb-3 title-2xl-semi-bold text-xl wrap-break-word text-text-primary">
        {!isEditing
          ? t(($) => $['mcp.server.modal.addTitle'], { ns: 'tools' })
          : t(($) => $['mcp.server.modal.editTitle'], { ns: 'tools' })}
      </DialogTitle>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="min-w-0 space-y-5 px-6 py-3">
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
              readOnly={isPending}
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
                      readOnly={isPending}
                      value={params[variable] || ''}
                      onChange={(value) => handleParamChange(variable, value)}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-row-reverse flex-wrap gap-2 p-6 pt-5">
        <Button disabled={!description} loading={isPending} type="submit" variant="primary">
          {isEditing
            ? t(($) => $['mcp.modal.save'], { ns: 'tools' })
            : t(($) => $['mcp.server.modal.confirm'], { ns: 'tools' })}
        </Button>
        <DialogClose disabled={isPending} render={<Button />}>
          {t(($) => $['mcp.modal.cancel'], { ns: 'tools' })}
        </DialogClose>
      </div>
    </form>
  )
}

export function MCPServerModal({ appID, data, open, onOpenChange, ...props }: ModalProps) {
  const { mutateAsync: createMCPServer, isPending: creating } = useCreateMCPServer()
  const { mutateAsync: updateMCPServer, isPending: updating } = useUpdateMCPServer()
  const invalidateMCPServerDetail = useInvalidateMCPServerDetail()
  const isPending = creating || updating

  const submit = async ({ description, parameters }: MCPServerValues) => {
    if (isPending) return
    try {
      if (!data) {
        const payload: { appID: string; description?: string; parameters: Record<string, string> } =
          { appID, parameters }
        if (description.trim()) payload.description = description
        await createMCPServer(payload)
      } else {
        await updateMCPServer({ appID, id: data.id, parameters, description })
      }
      void invalidateMCPServerDetail(appID)
      onOpenChange(false)
    } catch {
      // The request layer reports errors; retain this session for retry.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending) details.cancel()
        else onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-130! flex-col overflow-hidden! border-none p-0! text-left align-middle transition-all duration-100 ease-in">
        <MCPServerForm {...props} data={data} isPending={isPending} onSubmit={submit} />
      </DialogContent>
    </Dialog>
  )
}
