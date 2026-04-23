/* eslint-disable react-refresh/only-export-components */
import type { FormInputItem } from '../types'
import { cn } from '@langgenius/dify-ui/cn'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { TransferMethod } from '@/types/app'
import { isFileFormInput, isFileListFormInput, isSelectFormInput } from '../types'

const variableRegex = /\{\{#(.+?)#\}\}/g
const noteRegex = /\{\{#\$(.+?)#\}\}/g

type MarkdownNode = {
  type?: string
  value?: string
  tagName?: string
  properties?: Record<string, string>
  children?: MarkdownNode[]
}

type SplitMatchResult = {
  tagName: string
  properties: Record<string, string>
}

const splitTextNode = (
  value: string,
  regex: RegExp,
  createMatchNode: (match: RegExpExecArray) => SplitMatchResult,
) => {
  const parts: MarkdownNode[] = []
  let lastIndex = 0
  let match = regex.exec(value)

  while (match !== null) {
    if (match.index > lastIndex)
      parts.push({ type: 'text', value: value.slice(lastIndex, match.index) })

    const { tagName, properties } = createMatchNode(match)
    parts.push({
      type: 'element',
      tagName,
      properties,
      children: [],
    })

    lastIndex = match.index + match[0].length
    match = regex.exec(value)
  }

  if (!parts.length)
    return parts

  if (lastIndex < value.length)
    parts.push({ type: 'text', value: value.slice(lastIndex) })

  return parts
}

const visitTextNodes = (
  node: MarkdownNode,
  transform: (value: string, parent: MarkdownNode) => MarkdownNode[] | null,
) => {
  if (!node.children)
    return

  let index = 0
  while (index < node.children.length) {
    const child = node.children[index]
    if (child!.type === 'text' && typeof child!.value === 'string') {
      const nextNodes = transform(child!.value, node)
      if (nextNodes) {
        node.children.splice(index, 1, ...nextNodes)
        index += nextNodes.length
        continue
      }
    }

    visitTextNodes(child!, transform)
    index++
  }
}

const replaceNodeIdsWithNames = (path: string, nodeName: (nodeId: string) => string) => {
  return path.replace(/#([^#.]+)([.#])/g, (_, nodeId: string, separator: string) => {
    return `#${nodeName(nodeId)}${separator}`
  })
}

const formatVariablePath = (path: string) => {
  return path.replaceAll('.', '/')
    .replace('{{#', '{{')
    .replace('#}}', '}}')
}

export function rehypeVariable() {
  return (tree: MarkdownNode) => {
    visitTextNodes(tree, (value) => {
      variableRegex.lastIndex = 0
      noteRegex.lastIndex = 0
      if (!variableRegex.test(value) || noteRegex.test(value))
        return null

      variableRegex.lastIndex = 0
      return splitTextNode(value, variableRegex, match => ({
        tagName: 'variable',
        properties: { dataPath: match[0].trim() },
      }))
    })
  }
}

export function rehypeNotes() {
  return (tree: MarkdownNode) => {
    visitTextNodes(tree, (value, parent) => {
      noteRegex.lastIndex = 0
      if (!noteRegex.test(value))
        return null

      noteRegex.lastIndex = 0
      parent.tagName = 'div'
      return splitTextNode(value, noteRegex, (match) => {
        const name = match[0].split('.').slice(-1)[0]!.replace('#}}', '')
        return {
          tagName: 'section',
          properties: { dataName: name },
        }
      })
    })
  }
}

export const Variable: React.FC<{ path: string }> = ({ path }) => {
  return (
    <span className="text-text-accent">
      {formatVariablePath(path)}
    </span>
  )
}

const SelectPreview: React.FC<{ label: string, options: string[] }> = ({ label, options }) => {
  const [value, setValue] = React.useState(options[0] || label)

  return (
    <div data-testid="human-input-note-select-preview" className="my-3">
      <Select value={value} onValueChange={nextValue => nextValue && setValue(nextValue)}>
        <SelectTrigger size="large" className="w-full rounded-[10px]" aria-label="human-input-note-select">
          {value}
        </SelectTrigger>
        <SelectContent listClassName="max-h-[140px] overflow-y-auto">
          {options.map(option => (
            <SelectItem key={option} value={option}>
              <SelectItemText>{option}</SelectItemText>
              <SelectItemIndicator />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const FileUploadPreview: React.FC<{ methods: TransferMethod[], t: (key: string, options?: Record<string, unknown>) => string }> = ({ methods, t }) => {
  const normalizedMethods = methods.length
    ? methods
    : [TransferMethod.local_file, TransferMethod.remote_url]
  const actions = [
    normalizedMethods.includes(TransferMethod.local_file) && {
      iconClassName: 'i-ri-upload-cloud-2-line',
      label: t('fileUploader.uploadFromComputer', { ns: 'common' }),
    },
    normalizedMethods.includes(TransferMethod.remote_url) && {
      iconClassName: 'i-ri-link',
      label: t('fileUploader.pasteFileLink', { ns: 'common' }),
    },
  ].filter(Boolean) as Array<{ iconClassName: string, label: string }>

  return (
    <div
      data-testid="human-input-note-file-preview"
      className={cn(
        'my-3 grid gap-2',
        actions.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
      )}
    >
      {actions.map(action => (
        <div
          key={action.label}
          className="flex h-10 items-center justify-center rounded-xl bg-components-input-bg-normal px-3"
        >
          <span className={cn('mr-2 size-5 shrink-0 text-text-tertiary', action.iconClassName)} />
          <span className="truncate system-sm-medium text-text-tertiary">
            {action.label}
          </span>
        </div>
      ))}
    </div>
  )
}

export const Note: React.FC<{ input: FormInputItem, nodeName: (nodeId: string) => string }> = ({ input, nodeName }) => {
  const { t } = useTranslation()
  if (isSelectFormInput(input)) {
    const isVariable = input.option_source.type === 'variable'
    const label = isVariable
      ? t('nodes.humanInput.insertInputField.variable', { ns: 'workflow' })
      : input.option_source.value[0] || t('variableConfig.select', { ns: 'appDebug' })
    const options = isVariable ? [label] : input.option_source.value
    return <SelectPreview label={label} options={options} />
  }

  if (isFileFormInput(input)) {
    return <FileUploadPreview methods={input.allowed_file_upload_methods} t={t} />
  }

  if (isFileListFormInput(input)) {
    return <FileUploadPreview methods={input.allowed_file_upload_methods} t={t} />
  }

  const isVariable = input.default.type === 'variable'
  const path = `{{#${input.default.selector.join('.')}#}}`
  const newPath = path ? replaceNodeIdsWithNames(path, nodeName) : path
  return (
    <div className="my-3 rounded-[10px] bg-components-input-bg-normal px-2.5 py-2">
      {isVariable ? <Variable path={newPath} /> : <span>{input.default.value}</span>}
    </div>
  )
}
