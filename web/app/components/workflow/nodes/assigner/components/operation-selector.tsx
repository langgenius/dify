import type { FC } from 'react'
import { useState } from 'react'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import type { WriteMode } from '../types'
import { getOperationItems } from '../utils'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { VarType } from '@/app/components/workflow/types'
import Divider from '@/app/components/base/divider'

type Item = {
  value: string | number
  name: string
}

type OperationSelectorProps = {
  value: string | number
  onSelect: (value: Item) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  popupClassName?: string
  assignedVarType?: VarType
  writeModeTypes?: WriteMode[]
  writeModeTypesArr?: WriteMode[]
  writeModeTypesNum?: WriteMode[]
}

const i18nPrefix = 'workflow.nodes.assigner'

const OperationSelector: FC<OperationSelectorProps> = ({
  value,
  onSelect,
  disabled = false,
  className,
  popupClassName,
  assignedVarType,
  writeModeTypes,
  writeModeTypesArr,
  writeModeTypesNum,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const items = getOperationItems(assignedVarType, writeModeTypes, writeModeTypesArr, writeModeTypesNum)

  const selectedItem = items.find(item => item.value === value)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger
        onClick={() => !disabled && setOpen(v => !v)}
      >
        <div
          className={classNames(
            'flex items-center px-2 py-1 gap-0.5 rounded-lg bg-components-input-bg-normal',
            disabled ? 'cursor-not-allowed !bg-components-input-bg-disabled' : 'cursor-pointer hover:bg-state-base-hover-alt',
            open && 'bg-state-base-hover-alt',
            className,
          )}
        >
          <div className='flex p-1 items-center'>
            <span
              className={`truncate overflow-hidden text-ellipsis system-sm-regular
                ${selectedItem ? 'text-components-input-text-filled' : 'text-components-input-text-disabled'}`}
            >
              {selectedItem?.name ? t(`${i18nPrefix}.operations.${selectedItem?.name}`) : t(`${i18nPrefix}.operations.title`)}
            </span>
          </div>
          <RiArrowDownSLine className={`h-4 w-4 text-text-quaternary ${disabled && 'text-components-input-text-placeholder'} ${open && 'text-text-secondary'}`} />
        </div>
      </PortalToFollowElemTrigger>

      <PortalToFollowElemContent className={`z-20 ${popupClassName}`}>
        <div className='flex w-[140px] flex-col items-start rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <div className='flex p-1 flex-col items-start self-stretch'>
            <div className='flex px-3 pt-1 pb-0.5 items-start self-stretch'>
              <div className='flex grow text-text-tertiary system-xs-medium-uppercase'>{t(`${i18nPrefix}.operations.title`)}</div>
            </div>
            {items.map(item => (
              item.value === 'divider'
                ? (
                  <Divider key="divider" className="my-1" />
                )
                : (
                  <div
                    key={item.value}
                    className={classNames(
                      'flex items-center px-2 py-1 gap-1 self-stretch rounded-lg',
                      'cursor-pointer hover:bg-state-base-hover',
                    )}
                    onClick={() => {
                      onSelect(item)
                      setOpen(false)
                    }}
                  >
                    <div className='flex min-h-5 px-1 items-center gap-1 grow'>
                      <span className={'flex flex-grow text-text-secondary system-sm-medium'}>{t(`${i18nPrefix}.operations.${item.name}`)}</span>
                    </div>
                    {item.value === value && (
                      <div className='flex justify-center items-center'>
                        <RiCheckLine className='h-4 w-4 text-text-accent' />
                      </div>
                    )}
                  </div>
                )
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default OperationSelector
