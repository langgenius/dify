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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { useNodesInteractions } from '../../../hooks/use-nodes-interactions'
import { parseCurl } from './curl-parser'

type CurlImportDialogProps = {
  nodeId: string
  readOnly: boolean
  onImport: (node: HttpNodeType) => void
}

function CurlImportForm({ nodeId, onImport }: Pick<CurlImportDialogProps, 'nodeId' | 'onImport'>) {
  const { handleNodeSelect } = useNodesInteractions()
  const [inputString, setInputString] = useState('')
  const { t } = useTranslation(['common', 'workflowIntegrations'])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const { node, error } = parseCurl(inputString)
        if (error) {
          toast.error(error)
          return
        }
        if (!node) return
        onImport(node)
        // Rebuild the selected node panel so its request editors read the imported values.
        handleNodeSelect(nodeId, true)
        setTimeout(() => handleNodeSelect(nodeId), 0)
      }}
    >
      <Textarea
        aria-label={t(($) => $['nodes.http.curl.title'], { ns: 'workflowIntegrations' })}
        value={inputString}
        className="my-3 h-40 w-full grow"
        onValueChange={setInputString}
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

export function CurlImportDialog({ nodeId, readOnly, onImport }: CurlImportDialogProps) {
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
    actionsRef.current?.close()
    onImport(node)
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
        <CurlImportForm nodeId={nodeId} onImport={handleImport} />
      </DialogContent>
    </Dialog>
  )
}
