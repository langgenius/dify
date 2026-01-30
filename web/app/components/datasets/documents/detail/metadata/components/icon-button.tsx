import type { FC } from 'react'
import type { DocType } from '@/models/datasets'
import { memo } from 'react'
import Tooltip from '@/app/components/base/tooltip'
import { useMetadataMap } from '@/hooks/use-metadata'
import { cn } from '@/utils/classnames'
import s from '../style.module.css'
import TypeIcon from './type-icon'

export type IconButtonProps = {
  type: DocType
  isChecked: boolean
}

const IconButton: FC<IconButtonProps> = ({ type, isChecked = false }) => {
  const metadataMap = useMetadataMap()

  return (
    <Tooltip
      popupContent={metadataMap[type].text}
    >
      <button type="button" className={cn(s.iconWrapper, 'group', isChecked ? s.iconCheck : '')}>
        <TypeIcon
          iconName={metadataMap[type].iconName || ''}
          className={`group-hover:bg-primary-600 ${isChecked ? '!bg-primary-600' : ''}`}
        />
      </button>
    </Tooltip>
  )
}

export default memo(IconButton)
