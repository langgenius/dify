'use client'
import type { FC } from 'react'
import type { Topic } from '../types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { uniqueId } from 'es-toolkit/compat'
import * as React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Editor from '@/app/components/workflow/nodes/_base/components/prompt/editor'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

const i18nPrefix = 'nodes.questionClassifiers'

type Props = {
  className?: string
  headerClassName?: string
  nodeId: string
  payload: Topic
  onChange: (payload: Topic) => void
  onRemove: () => void
  index: number
  readonly?: boolean
  filterVar: (payload: Var, valueSelector: ValueSelector) => boolean
}

const ClassItem: FC<Props> = ({
  className,
  headerClassName,
  nodeId,
  payload,
  onChange,
  onRemove,
  index,
  readonly,
  filterVar,
}) => {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = useState(() => uniqueId())

  useEffect(() => {
    setInstanceId(`${nodeId}-${uniqueId()}`)
  }, [nodeId])

  const handleNameChange = useCallback((value: string) => {
    onChange({ ...payload, name: value })
  }, [onChange, payload])

  const { availableVars, availableNodesWithParent } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    hideChatVar: false,
    hideEnv: false,
    filterVar,
  })

  return (
    <Editor
      className={className}
      headerClassName={headerClassName}
      title={`${t(`${i18nPrefix}.class`, { ns: 'workflow' })} ${index}`}
      placeholder={t(`${i18nPrefix}.topicPlaceholder`, { ns: 'workflow' })!}
      value={payload.name}
      onChange={handleNameChange}
      showRemove
      onRemove={onRemove}
      nodesOutputVars={availableVars}
      availableNodes={availableNodesWithParent}
      readOnly={readonly} // ?
      instanceId={instanceId}
      justVar // ?
      isSupportFileVar // ?
    />
  )
}
export default React.memo(ClassItem)
