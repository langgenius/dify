import type { FC } from 'react'
import { Fragment } from 'react'
import { Popover, Transition } from '@headlessui/react'
import { useTranslation } from 'react-i18next'
import { DotsHorizontal, Trash03 } from '@/app/components/base/icons/src/vender/line/general'

const itemClassName = `
flex items-center px-3 h-9 text-sm text-gray-700 rounded-lg cursor-pointer
`

type OperationProps = {
  onOperate: (v: Record<string, string>) => void
}

const Operation: FC<OperationProps> = ({
  onOperate,
}) => {
  const { t } = useTranslation()

  return (
    <Popover className='relative'>
      <Popover.Button>
        {
          ({ open }) => (
            <div className={`
              flex justify-center items-center w-7 h-7 bg-white rounded-md border-[0.5px] border-gray-200 shadow-xs cursor-pointer
              ${open && 'bg-gray-100 shadow-none'}
            `}>
              <DotsHorizontal className='w-4 h-4 text-gray-700' />
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
        <Popover.Panel className='absolute top-8 right-0 w-[144px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg z-10'>
          <div className='p-1'>
            <Popover.Button as={Fragment}>
              <div className={`group ${itemClassName} hover:bg-[#FEF3F2] hover:text-[#D92D20]`} onClick={() => onOperate({ type: 'delete' })}>
                <Trash03 className='mr-2 w-4 h-4 text-gray-500 group-hover:text-[#D92D20]' />
                {t('common.operation.remove')}
              </div>
            </Popover.Button>
          </div>
        </Popover.Panel>
      </Transition>
    </Popover>
  )
}

export default Operation
