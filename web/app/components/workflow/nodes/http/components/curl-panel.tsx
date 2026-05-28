'use client'
import type { FC } from 'react'
import type { HttpNodeType } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'
import { useNodesInteractions } from '@/app/components/workflow/hooks'
import { parseCurl } from './curl-parser'

type Props = {
  nodeId: string
  isShow: boolean
  onHide: () => void
  handleCurlImport: (node: HttpNodeType) => void
}

const CurlPanel: FC<Props> = ({ nodeId, isShow, onHide, handleCurlImport }) => {
  const [inputString, setInputString] = useState('')
  const { handleNodeSelect } = useNodesInteractions()
  const { t } = useTranslation()

  const handleSave = useCallback(() => {
    const { node, error } = parseCurl(inputString)
    if (error) {
      toast.error(error)
      return
    }
    if (!node)
      return

    onHide()
    handleCurlImport(node)
    // Close the panel then open it again to make the panel re-render
    handleNodeSelect(nodeId, true)
    setTimeout(() => {
      handleNodeSelect(nodeId)
    }, 0)
  }, [onHide, nodeId, inputString, handleNodeSelect, handleCurlImport])

  return (
    <Dialog
      open={isShow}
      onOpenChange={(open) => {
        if (!open)
          onHide()
      }}
    >
      <DialogContent className="w-[400px]! max-w-[400px]! overflow-hidden! border-none p-4! text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('nodes.http.curl.title', { ns: 'workflow' })}
        </DialogTitle>

        <div>
          <Textarea
            value={inputString}
            className="my-3 h-40 w-full grow"
            onChange={e => setInputString(e.target.value)}
            placeholder={t('nodes.http.curl.placeholder', { ns: 'workflow' })!}
          />
        </div>
        <div className="mt-4 flex justify-end space-x-2">
          <Button className="w-[95px]!" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button className="w-[95px]!" variant="primary" onClick={handleSave}>
            {' '}
            {t('operation.save', { ns: 'common' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default React.memo(CurlPanel)
