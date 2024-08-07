import { Fragment } from 'react'
import type { FC } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import {
  RiCheckLine,
  RiMoreFill,
} from '@remixicon/react'
import { PreferredProviderTypeEnum } from '../declarations'
import Button from '@/app/components/base/button'

type SelectorProps = {
  value?: string
  onSelect: (key: PreferredProviderTypeEnum) => void
}
const Selector: FC<SelectorProps> = ({
  value,
  onSelect,
}) => {
  const { t } = useTranslation()
  const options = [
    {
      key: PreferredProviderTypeEnum.custom,
      text: t('common.modelProvider.apiKey'),
    },
    {
      key: PreferredProviderTypeEnum.system,
      text: t('common.modelProvider.quota'),
    },
  ]

  return (
    <Popover className='relative'>
      <Popover.Button>
        {
          ({ open }) => (
            <Button className={`
              px-0 w-6 h-6 bg-white rounded-md
              ${open && '!bg-gray-100'}
            `}>
              <RiMoreFill className='w-3 h-3 text-gray-700' />
            </Button>
          )
        }
      </Popover.Button>
      <Transition
        as={Fragment}
        leave='transition ease-in duration-100'
        leaveFrom='opacity-100'
        leaveTo='opacity-0'
      >
        <Popover.Panel className='absolute top-7 right-0 w-[144px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg z-10'>
          <div className='p-1'>
            <div className='px-3 pt-2 pb-1 text-sm font-medium text-gray-700'>{t('common.modelProvider.card.priorityUse')}</div>
            {
              options.map(option => (
                <Popover.Button as={Fragment} key={option.key}>
                  <div
                    className='flex items-center justify-between px-3 h-9 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'
                    onClick={() => onSelect(option.key)}
                  >
                    <div className='grow'>{option.text}</div>
                    {value === option.key && <RiCheckLine className='w-4 h-4 text-primary-600' />}
                  </div>
                </Popover.Button>
              ))
            }
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default Selector
