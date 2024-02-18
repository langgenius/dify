import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import BaseNode from '../_base/node'
const i18nPrefix = 'workflow.nodes.llm'

const Node: FC = () => {
  const { t } = useTranslation()

  return (
    <BaseNode>
      <div>
        llm
      </div>
    </BaseNode>
  )
}

export default Node
