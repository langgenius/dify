import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import { t } from 'i18next'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import type { CodeDependency } from './types'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import Input from '@/app/components/base/input'
import { Check } from '@/app/components/base/icons/src/vender/line/general'

type Props = {
  value: CodeDependency
  available_dependencies: CodeDependency[]
  onChange: (dependency: CodeDependency) => void
}

const DependencyPicker: FC<Props> = ({
  available_dependencies,
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  const handleChange = useCallback((dependency: CodeDependency) => {
    return () => {
      setOpen(false)
      onChange(dependency)
    }
  }, [onChange])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)} className='flex-grow cursor-pointer'>
        <div className='flex items-center h-8 justify-between px-2.5 rounded-lg border-0 bg-gray-100 text-gray-900 text-[13px]'>
          <div className='grow w-0 truncate' title={value.name}>{value.name}</div>
          <RiArrowDownSLine className='shrink-0 w-3.5 h-3.5 text-gray-700' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{
        zIndex: 100,
      }}>
        <div className='p-1 bg-white rounded-lg shadow-sm' style={{
          width: 350,
        }}>
          <div className='mb-2 mx-1'>
            <Input
              showLeftIcon
              showClearIcon
              value={searchText}
              placeholder={t('workflow.nodes.code.searchDependencies') || ''}
              onChange={e => setSearchText(e.target.value)}
              onClear={() => setSearchText('')}
              autoFocus
            />
          </div>
          <div className='max-h-[30vh] overflow-y-auto'>
            {available_dependencies.filter((v) => {
              if (!searchText)
                return true
              return v.name.toLowerCase().includes(searchText.toLowerCase())
            }).map(dependency => (
              <div
                key={dependency.name}
                className='flex items-center h-[30px] justify-between pl-3 pr-2 rounded-lg hover:bg-gray-100 text-gray-900 text-[13px] cursor-pointer'
                onClick={handleChange(dependency)}
              >
                <div className='w-0 grow truncate'>{dependency.name}</div>
                {dependency.name === value.name && <Check className='shrink-0 w-4 h-4 text-primary-600' />}
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(DependencyPicker)
