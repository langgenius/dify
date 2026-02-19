import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import Placeholder from '@/app/components/workflow/nodes/tool/components/mixed-variable-text-input/placeholder'
import { BlockEnum } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

type MailBodyInputProps = {
  readOnly?: boolean
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  value?: string
  onChange?: (text: string) => void
}

const MailBodyInput = ({
  readOnly = false,
  nodesOutputVars,
  availableNodes = [],
  value = '',
  onChange,
}: MailBodyInputProps) => {
  const { t } = useTranslation()

  return (
    <PromptEditor
      wrapperClassName={cn(
        'w-full rounded-lg border border-transparent bg-components-input-bg-normal px-2 py-1',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      )}
      className="caret:text-text-accent min-h-[128px]"
      editable={!readOnly}
      value={value}
      requestURLBlock={{
        show: true,
        selectable: true,
      }}
      workflowVariableBlock={{
        show: true,
        variables: nodesOutputVars || [],
        workflowNodesMap: availableNodes.reduce((acc, node) => {
          acc[node.id] = {
            title: node.data.title,
            type: node.data.type,
          }
          if (node.data.type === BlockEnum.Start) {
            acc.sys = {
              title: t('blocks.start', { ns: 'workflow' }),
              type: BlockEnum.Start,
            }
          }
          return acc
        }, {} as Record<string, Pick<Node['data'], 'title' | 'type'>>),
      }}
      placeholder={<Placeholder hideBadge />}
      onChange={onChange}
    />
  )
}

export default MailBodyInput
