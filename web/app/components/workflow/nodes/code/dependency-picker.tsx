import type { FC } from 'react'
import type { CodeDependency } from './types'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import { t } from 'i18next'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { Check } from '@/app/components/base/icons/src/vender/line/general'
import Input from '@/app/components/base/input'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'

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
      placement="bottom-start"
      offset={4}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)} className="grow cursor-pointer">
        <div className="flex h-8 items-center justify-between rounded-lg border-0 bg-gray-100 px-2.5 text-[13px] text-gray-900">
          <div className="w-0 grow truncate" title={value.name}>{value.name}</div>
          <RiArrowDownSLine className="h-3.5 w-3.5 shrink-0 text-gray-700" />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{
        zIndex: 100,
      }}
      >
        <div
          className="rounded-lg bg-white p-1 shadow-sm"
          style={{
            width: 350,
          }}
        >
          <div className="mx-1 mb-2">
            <Input
              showLeftIcon
              showClearIcon
              value={searchText}
              placeholder={t('nodes.code.searchDependencies', { ns: 'workflow' }) || ''}
              onChange={e => setSearchText(e.target.value)}
              onClear={() => setSearchText('')}
              autoFocus
            />
          </div>
          <div className="max-h-[30vh] overflow-y-auto">
            {available_dependencies.filter((v) => {
              if (!searchText)
                return true
              return v.name.toLowerCase().includes(searchText.toLowerCase())
            }).map(dependency => (
              <div
                key={dependency.name}
                className="flex h-[30px] cursor-pointer items-center justify-between rounded-lg pl-3 pr-2 text-[13px] text-gray-900 hover:bg-gray-100"
                onClick={handleChange(dependency)}
              >
                <div className="w-0 grow truncate">{dependency.name}</div>
                {dependency.name === value.name && <Check className="h-4 w-4 shrink-0 text-primary-600" />}
              </div>
            ))}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(DependencyPicker)
