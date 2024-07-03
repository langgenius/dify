import { Menu, Transition } from '@headlessui/react'
import React, { Fragment, useMemo } from 'react'
import type { FilterMode } from '../types'
import AddButton from '@/app/components/base/button/add-button'

export const filterModes: {
  [K in FilterMode]: {
    label: K
  }
} = {
  must: {
    label: 'must',
  },
  should: {
    label: 'should',
  },
  must_not: {
    label: 'must_not',
  },
}

type Props = {
  selectedKeys: string[]
  readonly: boolean
  onSelect: (selectedKey: FilterMode) => void
}

const allMenuData = Object.entries(filterModes).map(([key, value]) => ({
  key,
  label: value.label,
}))

export default function AddMetaDataFilter({ selectedKeys, onSelect, readonly }: Props) {
  const showMenuData = useMemo(() => allMenuData.filter(item => !selectedKeys.includes(item.key)), [selectedKeys])

  return (showMenuData.length && !readonly)
    ? (
      <Menu as="div" className="relative h-[24px]">
        <Menu.Button>
          <AddButton />
        </Menu.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute z-10 right-0 w-56 origin-top-right divide-y border-[0.5px] border-gray-200 rounded-lg shadow-xl bg-white">
            <div className="px-1 py-1 ">{showMenuData.map(item => (
              <Menu.Item key={item.key}>
                {({ active }) => (
                  <button
                    onClick={() => onSelect(item.key as FilterMode)}
                    className={`${active ? 'bg-gray-50' : ''} text-gray-900 group flex w-full items-center rounded-md px-2 py-2 text-sm`}
                  >
                    {item.label}
                  </button>
                )}
              </Menu.Item>
            ))}
            </div>
          </Menu.Items>
        </Transition>
      </Menu>
    )
    : null
}
