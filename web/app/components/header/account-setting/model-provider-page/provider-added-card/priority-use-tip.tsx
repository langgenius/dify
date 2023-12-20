import { ChevronDownDouble } from '@/app/components/base/icons/src/vender/line/arrows'
import Tooltip from '@/app/components/base/tooltip'

const PriorityUseTip = () => {
  return (
    <Tooltip selector='provider-quota-credential-priority-using' content='Prioritize using'>
      <div className='absolute -right-[5px] -top-[5px] bg-indigo-50 rounded-[5px] border-[0.5px] border-indigo-100 cursor-pointer'>
        <ChevronDownDouble className='rotate-180 w-3 h-3 text-indigo-600' />
      </div>
    </Tooltip>
  )
}

export default PriorityUseTip
