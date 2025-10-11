import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_QUERY_BLOCK_COMMAND } from './index'
import { UserEdit02 } from '@/app/components/base/icons/src/vender/solid/users'

type QueryBlockComponentProps = {
  nodeKey: string
}

const QueryBlockComponent: FC<QueryBlockComponentProps> = ({
  nodeKey,
}) => {
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_QUERY_BLOCK_COMMAND)

  return (
    <div
      className={`
        inline-flex h-6 items-center rounded-[5px] border border-transparent bg-[#FFF6ED] pl-1 pr-0.5 hover:bg-[#FFEAD5]
        ${isSelected && '!border-[#FD853A]'}
      `}
      ref={ref}
    >
      <UserEdit02 className='mr-1 h-[14px] w-[14px] text-[#FD853A]' />
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'{{'}</div>
      <div className='text-xs font-medium text-[#EC4A0A]'>{t('common.promptEditor.query.item.title')}</div>
      <div className='text-xs font-medium text-[#EC4A0A] opacity-60'>{'}}'}</div>
    </div>
  )
}

export default QueryBlockComponent
