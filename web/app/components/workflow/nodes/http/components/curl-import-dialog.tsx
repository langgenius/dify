'use client'

import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { HttpNodeType } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { parseCurl } from './curl-parser'

type CurlImportDialogProps = {
  readOnly: boolean
  onImport: (node: HttpNodeType) => void
}

function CurlImportForm({ onImport }: Pick<CurlImportDialogProps, 'onImport'>) {
  const { t } = useTranslation(['common', 'workflowIntegrations'])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const command = new FormData(event.currentTarget).get('curl')
        const result = parseCurl(typeof command === 'string' ? command : '')
        if (result.error === null) onImport(result.node)
        else toast.error(result.error)
      }}
    >
      <Textarea
        name="curl"
        aria-label={t(($) => $['nodes.http.curl.title'], { ns: 'workflowIntegrations' })}
        className="my-3 h-40 w-full grow"
        placeholder={t(($) => $['nodes.http.curl.placeholder'], { ns: 'workflowIntegrations' })}
      />
      <div className="mt-4 flex justify-end space-x-2">
        <DialogClose render={<Button className="w-23.75!" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" className="w-23.75!" variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </div>
    </form>
  )
}

export function CurlImportDialog({ readOnly, onImport }: CurlImportDialogProps) {
  const actionsRef = useRef<DialogActions>(null)
  const { t } = useTranslation(['workflowIntegrations'])
  const label = (
    <span className="text-xs font-medium text-text-tertiary">
      {t(($) => $['nodes.http.curl.title'], { ns: 'workflowIntegrations' })}
    </span>
  )

  if (readOnly)
    return <div className="flex h-6 items-center space-x-1 rounded-md px-2">{label}</div>

  const handleImport = (node: HttpNodeType) => {
    onImport(node)
    actionsRef.current?.close()
  }

  return (
    <Dialog actionsRef={actionsRef}>
      <DialogTrigger className="flex h-6 cursor-pointer items-center space-x-1 rounded-md px-2 hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden">
        <span
          aria-hidden
          className="i-custom-vender-line-files-file-arrow-01 size-3 text-text-tertiary"
        />
        {label}
      </DialogTrigger>
      <DialogContent className="w-100! max-w-100! overflow-hidden! border-none p-4! text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['nodes.http.curl.title'], { ns: 'workflowIntegrations' })}
        </DialogTitle>
        <CurlImportForm onImport={handleImport} />
      </DialogContent>
    </Dialog>
  )
}
