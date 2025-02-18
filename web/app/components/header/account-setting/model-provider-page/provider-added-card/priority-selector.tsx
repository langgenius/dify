import { Fragment } from 'react'
import type { FC } from 'react'
import { Popover, PopoverButton, PopoverPanel, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import {
  RiCheckLine,
  RiMoreFill,
} from '@remixicon/react'
import { PreferredProviderTypeEnum } from '../declarations'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

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
      <PopoverButton>
        {
          ({ open }) => (
            <Button className={cn(
              'h-6 w-6 rounded-md px-0',
              open && 'bg-components-button-secondary-bg-hover',
            )}>
              <RiMoreFill className='h-3 w-3' />
            </Button>
          )
        }
      </PopoverButton>
      <Transition
        as={Fragment}
        leave='transition ease-in duration-100'
        leaveFrom='opacity-100'
        leaveTo='opacity-0'
      >
        <PopoverPanel className='bg-components-panel-bg border-components-panel-border absolute right-0 top-7 z-10 w-[144px] rounded-lg border-[0.5px] shadow-lg'>
          <div className='p-1'>
            <div className='text-text-secondary px-3 pb-1 pt-2 text-sm font-medium'>{t('common.modelProvider.card.priorityUse')}</div>
            {
              options.map(option => (
                <PopoverButton as={Fragment} key={option.key}>
                  <div
                    className='text-text-secondary hover:bg-components-panel-on-panel-item-bg-hover flex h-9 cursor-pointer items-center justify-between rounded-lg px-3 text-sm'
                    onClick={() => onSelect(option.key)}
                  >
                    <div className='grow'>{option.text}</div>
                    {value === option.key && <RiCheckLine className='text-text-accent h-4 w-4' />}
                  </div>
                </PopoverButton>
              ))
            }
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  )
}

export default Selector
