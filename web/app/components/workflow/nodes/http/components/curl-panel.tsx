'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BodyType, type HttpNodeType, Method } from '../types'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { useNodesInteractions } from '@/app/components/workflow/hooks'

type Props = {
  nodeId: string
  isShow: boolean
  onHide: () => void
  handleCurlImport: (node: HttpNodeType) => void
}

const parseCurl = (curlCommand: string): { node: HttpNodeType | null; error: string | null } => {
  if (!curlCommand.trim().toLowerCase().startsWith('curl'))
    return { node: null, error: 'Invalid cURL command. Command must start with "curl".' }

  const node: Partial<HttpNodeType> = {
    title: 'HTTP Request',
    desc: 'Imported from cURL',
    method: Method.get,
    url: '',
    headers: '',
    params: '',
    body: { type: BodyType.none, data: '' },
  }
  const args = curlCommand.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i].replace(/^['"]|['"]$/g, '')
    switch (arg) {
      case '-X':
      case '--request':
        if (i + 1 >= args.length)
          return { node: null, error: 'Missing HTTP method after -X or --request.' }
        node.method = (args[++i].replace(/^['"]|['"]$/g, '') as Method) || Method.get
        break
      case '-H':
      case '--header':
        if (i + 1 >= args.length)
          return { node: null, error: 'Missing header value after -H or --header.' }
        node.headers += (node.headers ? '\n' : '') + args[++i].replace(/^['"]|['"]$/g, '')
        break
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
        if (i + 1 >= args.length)
          return { node: null, error: 'Missing data value after -d, --data, --data-raw, or --data-binary.' }
        node.body = { type: BodyType.rawText, data: args[++i].replace(/^['"]|['"]$/g, '') }
        break
      case '-F':
      case '--form': {
        if (i + 1 >= args.length)
          return { node: null, error: 'Missing form data after -F or --form.' }
        if (node.body?.type !== BodyType.formData)
          node.body = { type: BodyType.formData, data: '' }
        const formData = args[++i].replace(/^['"]|['"]$/g, '')
        const [key, ...valueParts] = formData.split('=')
        if (!key)
          return { node: null, error: 'Invalid form data format.' }
        let value = valueParts.join('=')

        // To support command like `curl -F "file=@/path/to/file;type=application/zip"`
        // the `;type=application/zip` should translate to `Content-Type: application/zip`
        const typeMatch = value.match(/^(.+?);type=(.+)$/)
        if (typeMatch) {
          const [, actualValue, mimeType] = typeMatch
          value = actualValue
          node.headers += `${node.headers ? '\n' : ''}Content-Type: ${mimeType}`
        }

        node.body.data += `${node.body.data ? '\n' : ''}${key}:${value}`
        break
      }
      case '--json':
        if (i + 1 >= args.length)
          return { node: null, error: 'Missing JSON data after --json.' }
        node.body = { type: BodyType.json, data: args[++i].replace(/^['"]|['"]$/g, '') }
        break
      default:
        if (arg.startsWith('http') && !node.url)
          node.url = arg
        break
    }
  }

  if (!node.url)
    return { node: null, error: 'Missing URL or url not start with http.' }

  // Extract query params from URL
  const urlParts = node.url?.split('?') || []
  if (urlParts.length > 1) {
    node.url = urlParts[0]
    node.params = urlParts[1].replace(/&/g, '\n').replace(/=/g, ': ')
  }

  return { node: node as HttpNodeType, error: null }
}

const CurlPanel: FC<Props> = ({ nodeId, isShow, onHide, handleCurlImport }) => {
  const [inputString, setInputString] = useState('')
  const { handleNodeSelect } = useNodesInteractions()
  const { t } = useTranslation()

  const handleSave = useCallback(() => {
    const { node, error } = parseCurl(inputString)
    if (error) {
      Toast.notify({
        type: 'error',
        message: error,
      })
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
      title={t('workflow.nodes.http.curl.title')}
      isShow={isShow}
      onClose={onHide}
      className='!w-[400px] !max-w-[400px] !p-4'
    >
      <div>
        <textarea
          value={inputString}
          className='w-full my-3 p-3 text-sm text-gray-900 border-0 rounded-lg grow bg-gray-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200 h-40'
          onChange={e => setInputString(e.target.value)}
          placeholder={t('workflow.nodes.http.curl.placeholder')!}
        />
      </div>
      <div className='mt-4 flex justify-end space-x-2'>
        <Button className='!w-[95px]' onClick={onHide} >{t('common.operation.cancel')}</Button>
        <Button className='!w-[95px]' variant='primary' onClick={handleSave} > {t('common.operation.save')}</Button>
      </div>
    </Modal>
  )
}

export default React.memo(CurlPanel)
