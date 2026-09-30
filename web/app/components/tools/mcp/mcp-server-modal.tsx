'use client'
import type { MCPServerParam } from './mcp-server-param-item'
import type { MCPServerDetail } from '@/app/components/tools/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Separator } from '@langgenius/dify-ui/separator'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'
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

const MCPServerModal = ({ appID, latestParams = [], data, show, onHide, appInfo }: ModalProps) => {
  const { t } = useTranslation(['common', 'tools'])
  const { mutateAsync: createMCPServer, isPending: creating } = useCreateMCPServer()
  const { mutateAsync: updateMCPServer, isPending: updating } = useUpdateMCPServer()
  const invalidateMCPServerDetail = useInvalidateMCPServerDetail()

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
      const payload: {
        appID: string
        description?: string
        parameters: Record<string, string>
      } = {
        appID,
        parameters: getParamValue(),
      }

      if (description.trim()) payload.description = description

      await createMCPServer(payload)
      invalidateMCPServerDetail(appID)
      onHide()
    } else {
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
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-130! overflow-x-hidden border-none p-0! text-left align-middle transition-all duration-100 ease-in"
        onFocusCapture={(event) => event.target.scrollIntoView({ block: 'nearest' })}
      >
        <button
          type="button"
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="absolute top-5 right-5 z-10 cursor-pointer border-none bg-transparent p-1.5 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
          onClick={onHide}
        >
          <span className="i-ri-close-line size-5 text-text-tertiary" aria-hidden="true" />
        </button>
        <Form className="flex flex-col" onFormSubmit={() => void submit()}>
          <DialogTitle className="relative shrink-0 p-6 pr-12 pb-3 title-2xl-semi-bold text-xl wrap-break-word text-text-primary">
            {!data
              ? t(($) => $['mcp.server.modal.addTitle'], { ns: 'tools' })
              : t(($) => $['mcp.server.modal.editTitle'], { ns: 'tools' })}
          </DialogTitle>
          <div className="min-w-0">
            <div className="min-w-0 space-y-5 px-6 py-3">
              <Field name="description" className="gap-0.5">
                <FieldLabel className="flex h-6 items-center gap-1 system-sm-medium text-text-secondary">
                  {t(($) => $['mcp.server.modal.description'], { ns: 'tools' })}
                  <span aria-hidden className="system-xs-regular text-text-destructive-secondary">
                    *
                  </span>
                </FieldLabel>
                <Textarea
                  required
                  className="h-24 resize-none"
                  value={description}
                  placeholder={t(($) => $['mcp.server.modal.descriptionPlaceholder'], {
                    ns: 'tools',
                  })}
                  onValueChange={(value) => setDescription(value)}
                />
              </Field>

              {latestParams.length > 0 && (
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <div className="shrink-0 system-xs-medium-uppercase text-text-primary">
                      {t(($) => $['mcp.server.modal.parameters'], { ns: 'tools' })}
                    </div>
                    <Separator
                      decorative
                      orientation="horizontal"
                      className="m-0 w-auto flex-1 bg-divider-subtle"
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
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2 p-6 pt-5">
            <Button type="button" onClick={onHide}>
              {t(($) => $['mcp.modal.cancel'], { ns: 'tools' })}
            </Button>
            <Button
              type="submit"
              disabled={!description}
              loading={creating || updating}
              variant="primary"
            >
              {data
                ? t(($) => $['mcp.modal.save'], { ns: 'tools' })
                : t(($) => $['mcp.server.modal.confirm'], { ns: 'tools' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export default MCPServerModal
