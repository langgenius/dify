'use client'
import type { FC } from 'react'
import type { HttpNodeType } from '../types'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Modal from '@/app/components/base/modal'
import Textarea from '@/app/components/base/textarea'
import { toast } from '@/app/components/base/ui/toast'
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
    <Modal
      title={t('nodes.http.curl.title', { ns: 'workflow' })}
      isShow={isShow}
      onClose={onHide}
      className="!w-[400px] !max-w-[400px] !p-4"
    >
      <div>
        <Textarea
          value={inputString}
          className="my-3 h-40 w-full grow"
          onChange={e => setInputString(e.target.value)}
          placeholder={t('nodes.http.curl.placeholder', { ns: 'workflow' })!}
        />
      </div>
      <div className="mt-4 flex justify-end space-x-2">
        <Button className="!w-[95px]" onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
        <Button className="!w-[95px]" variant="primary" onClick={handleSave}>
          {' '}
          {t('operation.save', { ns: 'common' })}
        </Button>
      </div>
    </Modal>
  )
}

export default React.memo(CurlPanel)
