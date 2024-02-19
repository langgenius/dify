import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
const i18nPrefix = 'workflow.nodes.llm'

const Node: FC = () => {
  const { t } = useTranslation()

  return (
    <div>llm</div>
  )
}

export default Node
