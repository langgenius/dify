import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
// import { mockData } from './mock'
const i18nPrefix = 'workflow.nodes.variableAssigner'

const Node: FC = () => {
  const { t } = useTranslation()
  // const { variables } = mockData
  return (
    <div className='px-3'>
      <div className='leading-4 text-xs font-medium text-gray-500 uppercase'>{t(`${i18nPrefix}.title`)}</div>
    </div>
  )
}

export default Node
