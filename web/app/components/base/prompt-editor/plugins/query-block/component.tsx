import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useSelectOrDelete } from '../../hooks'
import { DELETE_QUERY_BLOCK_COMMAND } from './index'

type QueryBlockComponentProps = {
  nodeKey: string
}

const QueryBlockComponent: FC<QueryBlockComponentProps> = ({ nodeKey }) => {
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_QUERY_BLOCK_COMMAND)

  return (
    <div
      className={`inline-flex h-6 items-center rounded-[5px] border border-transparent bg-[#FFF6ED] pr-0.5 pl-1 hover:bg-[#FFEAD5] ${isSelected && 'border-[#FD853A]!'} `}
      ref={ref}
    >
      <span
        aria-hidden
        className="mr-1 i-custom-vender-solid-users-user-edit-02 h-3.5 w-3.5 text-[#FD853A]"
      />
      <div className="text-xs font-medium text-[#EC4A0A] opacity-60">{'{{'}</div>
      <div className="text-xs font-medium text-[#EC4A0A]">
        {t(($) => $['promptEditor.query.item.title'], { ns: 'common' })}
      </div>
      <div className="text-xs font-medium text-[#EC4A0A] opacity-60">{'}}'}</div>
    </div>
  )
}

export default QueryBlockComponent
