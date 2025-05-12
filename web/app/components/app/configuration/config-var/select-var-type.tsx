'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import OperationBtn from '@/app/components/app/configuration/base/operation-btn'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { ApiConnection } from '@/app/components/base/icons/src/vender/solid/development'
import InputVarTypeIcon from '@/app/components/workflow/nodes/_base/components/input-var-type-icon'
import { InputVarType } from '@/app/components/workflow/types'

type Props = {
  onChange: (value: string) => void
}

type ItemProps = {
  text: string
  value: string
  Icon?: any
  type?: InputVarType
  onClick: (value: string) => void
}

const SelectItem: FC<ItemProps> = ({ text, type, value, Icon, onClick }) => {
  return (
    <div
      className='flex h-8 cursor-pointer items-center rounded-lg px-3 hover:bg-gray-50'
      onClick={() => onClick(value)}
    >
      {Icon ? <Icon className='h-4 w-4 text-gray-500' /> : <InputVarTypeIcon type={type!} className='h-4 w-4 text-gray-500' />}
      <div className='ml-2 truncate text-xs text-gray-600'>{text}</div>
    </div>
  )
}

const SelectVarType: FC<Props> = ({
  onChange,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const handleChange = (value: string) => {
    onChange(value)
    setOpen(false)
  }
  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 8,
        crossAxis: -2,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <OperationBtn type='add' className={cn(open && 'bg-gray-200')} />
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1000 }}>
        <div className='min-w-[192px] rounded-lg border border-gray-200 bg-white shadow-lg'>
          <div className='p-1'>
            <SelectItem type={InputVarType.textInput} value='string' text={t('appDebug.variableConfig.string')} onClick={handleChange}></SelectItem>
            <SelectItem type={InputVarType.paragraph} value='paragraph' text={t('appDebug.variableConfig.paragraph')} onClick={handleChange}></SelectItem>
            <SelectItem type={InputVarType.select} value='select' text={t('appDebug.variableConfig.select')} onClick={handleChange}></SelectItem>
            <SelectItem type={InputVarType.number} value='number' text={t('appDebug.variableConfig.number')} onClick={handleChange}></SelectItem>
          </div>
          <div className='h-[1px] bg-gray-100'></div>
          <div className='p-1'>
            <SelectItem Icon={ApiConnection} value='api' text={t('appDebug.variableConfig.apiBasedVar')} onClick={handleChange}></SelectItem>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default React.memo(SelectVarType)
