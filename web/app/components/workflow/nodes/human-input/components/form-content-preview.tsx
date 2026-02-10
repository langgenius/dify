'use client'
import type { FC } from 'react'
import type { FormInputItem, UserAction } from '../types'
import type { ButtonProps } from '@/app/components/base/button'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import Badge from '@/app/components/base/badge'
import Button from '@/app/components/base/button'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { Markdown } from '@/app/components/base/markdown'
import { useStore } from '@/app/components/workflow/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { Note, rehypeNotes, rehypeVariable, Variable } from './variable-in-markdown'

const i18nPrefix = 'nodes.humanInput'

type FormContentPreviewProps = {
  content: string
  formInputs: FormInputItem[]
  userActions: UserAction[]
  onClose: () => void
}

const FormContentPreview: FC<FormContentPreviewProps> = ({
  content,
  formInputs,
  userActions,
  onClose,
}) => {
  const { t } = useTranslation()
  const panelWidth = useStore(state => state.panelWidth)
  const nodes = useNodes()

  const nodeName = React.useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    return node?.data.title || nodeId
  }, [nodes])

  return (
    <div
      className="fixed top-[112px] z-10 max-h-[calc(100vh-116px)] w-[600px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-3 shadow-xl"
      style={{
        right: panelWidth + 8,
      }}
    >
      <div className="flex h-[26px] items-center justify-between px-4">
        <Badge uppercase className="border-text-accent-secondary text-text-accent-secondary">{t(`${i18nPrefix}.formContent.preview`, { ns: 'workflow' })}</Badge>
        <ActionButton onClick={onClose}><RiCloseLine className="w-5 text-text-tertiary" /></ActionButton>
      </div>
      <div className="max-h-[calc(100vh-167px)] overflow-y-auto px-4">
        <Markdown
          content={content}
          rehypePlugins={[rehypeVariable, rehypeNotes]}
          customComponents={{
            variable: ({ node }: { node: { properties?: { [key: string]: string } } }) => {
              const path = node.properties?.['data-path'] as string
              let newPath = path
              if (path) {
                newPath = path.replace(/#([^#.]+)([.#])/g, (match, nodeId, sep) => {
                  return `#${nodeName(nodeId)}${sep}`
                })
              }
              return <Variable path={newPath} />
            },
            section: ({ node }: { node: { properties?: { [key: string]: string } } }) => (() => {
              const name = node.properties?.['data-name'] as string
              const input = formInputs.find(i => i.output_variable_name === name)
              if (!input) {
                return (
                  <div>
                    Can't find note:
                    {name}
                  </div>
                )
              }
              const defaultInput = input.default
              return (
                <Note defaultInput={defaultInput!} nodeName={nodeName} />
              )
            })(),
          }}
        />
        <div className="mt-3 flex flex-wrap gap-1 py-1">
          {userActions.map((action: UserAction) => (
            <Button
              key={action.id}
              variant={getButtonStyle(action.button_style) as ButtonProps['variant']}
            >
              {action.title}
            </Button>
          ))}
        </div>
        <div className="system-xs-regular mt-1 text-text-tertiary">{t('nodes.humanInput.editor.previewTip', { ns: 'workflow' })}</div>
      </div>
    </div>
  )
}

export default React.memo(FormContentPreview)
