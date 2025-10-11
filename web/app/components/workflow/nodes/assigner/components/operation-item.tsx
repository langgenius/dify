import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AssignerNodeOperation } from '../types'
import { useFindNode } from '@/app/components/workflow/hooks/use-find-node'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import Badge from '@/app/components/base/badge'

type OperationItemProps = {
  value: AssignerNodeOperation
}

const i18nPrefix = 'workflow.nodes.assigner'

const OperationItem = ({ value }: OperationItemProps) => {
  const { t } = useTranslation()
  const variable = value.variable_selector
  const node = useFindNode(variable)
  if (!variable || variable.length === 0)
    return null

  return (
    <VariableLabelInNode
      variables={variable}
      nodeType={node?.data.type}
      nodeTitle={node?.data.title}
      rightSlot={
        value.operation && <Badge className='!ml-auto shrink-0' text={t(`${i18nPrefix}.operations.${value.operation}`)} />
      }
    />
  )
}

export default memo(OperationItem)
