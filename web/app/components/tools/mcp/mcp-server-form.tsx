'use client'
import type { MCPServerParam } from './mcp-server-param-item'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import MCPServerParamItem from '@/app/components/tools/mcp/mcp-server-param-item'

export type MCPServerFormValue = {
  description: string
  parameters: Record<string, string>
}

type MCPServerFormProps = {
  show: boolean
  // An existing server is edited; otherwise the form adds one.
  editing: boolean
  defaultDescription: string
  defaultParameters?: Record<string, string>
  latestParams?: MCPServerParam[]
  pending: boolean
  onHide: () => void
  onSubmit: (value: MCPServerFormValue) => Promise<void>
}

// The MCP server description and parameter form; the caller owns where it is saved.
export function MCPServerForm({
  show,
  editing,
  defaultDescription,
  defaultParameters,
  latestParams = [],
  pending,
  onHide,
  onSubmit,
}: MCPServerFormProps) {
  const { t } = useTranslation(['common', 'tools'])
  const [description, setDescription] = React.useState(defaultDescription)
  const [params, setParams] = React.useState<Record<string, string>>(defaultParameters || {})
  const descriptionId = React.useId()

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
    <Dialog
      open={show}
      onOpenChange={(open) => {
        if (!open) onHide()
      }}
    >
      <DialogContent className="w-130">
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault()
            if (!description || pending) return
            void onSubmit({ description, parameters: getParamValue() })
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {!editing
                ? t(($) => $['mcp.server.modal.addTitle'], { ns: 'tools' })
                : t(($) => $['mcp.server.modal.editTitle'], { ns: 'tools' })}
            </DialogTitle>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <DialogBody className="min-w-0 space-y-5">
            <div className="space-y-0.5">
              <div className="flex h-6 items-center gap-1">
                <label htmlFor={descriptionId} className="system-sm-medium text-text-secondary">
                  {t(($) => $['mcp.server.modal.description'], { ns: 'tools' })}
                </label>
                <span aria-hidden className="system-xs-regular text-text-destructive-secondary">
                  *
                </span>
              </div>
              <Textarea
                id={descriptionId}
                required
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
          <DialogFooter className="max-sm:flex-col max-sm:items-stretch">
            <Button onClick={onHide}>{t(($) => $['mcp.modal.cancel'], { ns: 'tools' })}</Button>
            <Button type="submit" disabled={!description} loading={pending} variant="primary">
              {editing
                ? t(($) => $['mcp.modal.save'], { ns: 'tools' })
                : t(($) => $['mcp.server.modal.confirm'], { ns: 'tools' })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
