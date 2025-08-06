import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiGlobalLine } from '@remixicon/react'

import { useSelectOrDelete } from '../../hooks'
import { DELETE_REQUEST_URL_BLOCK_COMMAND } from './index'
import cn from '@/utils/classnames'

type RequestURLBlockComponentProps = {
  nodeKey: string
}

const RequestURLBlockComponent: FC<RequestURLBlockComponentProps> = ({
  nodeKey,
}) => {
  const { t } = useTranslation()
  const [ref, isSelected] = useSelectOrDelete(nodeKey, DELETE_REQUEST_URL_BLOCK_COMMAND)

  return (
    <div
      className={cn(
        'group/wrap relative mx-0.5 flex h-[18px] select-none items-center rounded-[5px] border border-components-panel-border-subtle bg-components-badge-white-to-dark px-1 hover:border-[#7839ee]',
        isSelected && '!border-[#7839ee] hover:!border-[#7839ee]',
      )}
      ref={ref}
    >
      <RiGlobalLine className='mr-0.5 h-3.5 w-3.5 text-util-colors-violet-violet-600' />
      <div className='system-xs-medium text-util-colors-violet-violet-600'>{t('common.promptEditor.requestURL.item.title')}</div>
    </div>
  )
}

export default RequestURLBlockComponent
