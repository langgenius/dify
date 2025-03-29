'use client'
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react'
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
          <MenuButton className="h-[44px]justify-center inline-flex w-full items-center rounded-lg border border-components-button-secondary-border px-[10px] py-[6px] text-[13px] font-medium text-text-primary hover:bg-state-base-hover">
            <GlobeAltIcon className="mr-1 h-5 w-5" aria-hidden="true" />
            {item?.name}
          </MenuButton>
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
          <MenuItems className="absolute right-0 z-10 mt-2 w-[200px] origin-top-right divide-y divide-divider-regular rounded-md bg-components-panel-bg shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <div className="px-1 py-1 ">
              {items.map((item) => {
                return <MenuItem key={item.value}>
                  <button
                    className={'group flex w-full items-center rounded-lg px-3 py-2 text-sm text-text-secondary data-[active]:bg-state-base-hover'}
                    onClick={(evt) => {
                      evt.preventDefault()
                      onChange && onChange(item.value)
                    }}
                  >
                    {item.name}
                  </button>
                </MenuItem>
              })}

            </div>

          </MenuItems>
        </Transition>
      </Menu>
    </div>
  )
}
