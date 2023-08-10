import { Fragment } from 'react'
import type { FC } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import { Check, DotsHorizontal, Trash03 } from '@/app/components/base/icons/src/vender/line/general'

const itemClassName = `
flex items-center px-3 h-9 text-sm text-gray-700 rounded-lg cursor-pointer
`

type SelectorProps = {
  value?: string
  onOperate: (v: Record<string, string>) => void
  hiddenOptions?: boolean
  className?: (v: boolean) => string
  deleteText?: string
}
const Selector: FC<SelectorProps> = ({
  value,
  onOperate,
  hiddenOptions,
  className,
  deleteText,
}) => {
  const { t } = useTranslation()
  const options = [
    {
      key: 'custom',
      text: 'API',
    },
    {
      key: 'system',
      text: t('common.modelProvider.quota'),
    },
  ]

  return (
    <Popover className='relative'>
      <Popover.Button>
        {
          ({ open }) => (
            <div className={`
              flex justify-center items-center w-6 h-6 rounded-md hover:bg-gray-50 cursor-pointer
              ${open && 'bg-gray-50'}
              ${className && className(open)}
            `}>
              <DotsHorizontal className='w-3 h-3 text-gray-700' />
            </div>
          )
        }
      </Popover.Button>
      <Transition
        as={Fragment}
        leave='transition ease-in duration-100'
        leaveFrom='opacity-100'
        leaveTo='opacity-0'
      >
        <Popover.Panel className='absolute top-7 right-0 w-[192px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg z-10'>
          {
            !hiddenOptions && (
              <>
                <div className='p-1'>
                  <div className='px-3 pt-2 pb-1 text-sm font-medium text-gray-700'>{t('common.modelProvider.card.priorityUse')}</div>
                  {
                    options.map(option => (
                      <Popover.Button as={Fragment} key={option.key}>
                        <div
                          className={`${itemClassName} hover:bg-gray-50`}
                          onClick={() => onOperate({ type: 'priority', value: option.key })}>
                          <div className='grow'>{option.text}</div>
                          {value === option.key && <Check className='w-4 h-4 text-primary-600' />}
                        </div>
                      </Popover.Button>
                    ))
                  }
                </div>
                <div className='h-[1px] bg-gray-100' />
              </>
            )
          }
          <div className='p-1'>
            <Popover.Button as={Fragment}>
              <div
                className={`group ${itemClassName} hover:bg-[#FEF3F2] hover:text-[#D92D20]`}
                onClick={() => onOperate({ type: 'delete' })}>
                <Trash03 className='mr-2 w-4 h-4 text-gray-500 group-hover:text-[#D92D20]' />
                {deleteText || t('common.modelProvider.card.removeKey')}
              </div>
            </Popover.Button>
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default Selector
