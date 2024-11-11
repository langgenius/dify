'use client'
import { Menu, Transition } from '@headlessui/react'
import { Fragment } from 'react'
import { GlobeAltIcon } from '@heroicons/react/24/outline'

type ISelectProps = {
  items: Array<{ value: string; name: string }>
  value?: string
  className?: string
  onChange?: (value: string) => void
}

export default function Select({
  items,
  value,
  onChange,
}: ISelectProps) {
  const item = items.filter(item => item.value === value)[0]

  return (
    <div className="w-56 text-right">
      <Menu as="div" className="relative inline-block text-left">
        <div>
          <Menu.Button className="inline-flex w-full h-[44px]justify-center items-center
          rounded-lg px-[10px] py-[6px]
          text-gray-900 text-[13px] font-medium
          border border-gray-200
          hover:bg-gray-100">
            <GlobeAltIcon className="w-5 h-5 mr-1" aria-hidden="true" />
            {item?.name}
          </Menu.Button>
        </div>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 mt-2 w-[200px] origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
            <div className="px-1 py-1 ">
              {items.map((item) => {
                return <Menu.Item key={item.value}>
                  {({ active }) => (
                    <button
                      className={`${active ? 'bg-gray-100' : ''
                      } group flex w-full items-center rounded-lg px-3 py-2 text-sm text-gray-700`}
                      onClick={(evt) => {
                        evt.preventDefault()
                        onChange && onChange(item.value)
                      }}
                    >
                      {item.name}
                    </button>
                  )}
                </Menu.Item>
              })}

            </div>

          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  )
}

export function InputSelect({
  items,
  value,
  onChange,
}: ISelectProps) {
  const item = items.filter(item => item.value === value)[0]
  return (
    <div className="w-full">
      <Menu as="div" className="w-full">
        <div>
          <Menu.Button className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 sm:text-sm h-[38px] text-left">
            {item?.name}
          </Menu.Button>
        </div>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 mt-2 w-full origin-top-right divide-y divide-gray-100 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-10">
            <div className="px-1 py-1 ">
              {items.map((item) => {
                return <Menu.Item key={item.value}>
                  {({ active }) => (
                    <button
                      className={`${active ? 'bg-gray-100' : ''
                      } group flex w-full items-center rounded-md px-2 py-2 text-sm`}
                      onClick={() => {
                        onChange && onChange(item.value)
                      }}
                    >
                      {item.name}
                    </button>
                  )}
                </Menu.Item>
              })}

            </div>

          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  )
}
