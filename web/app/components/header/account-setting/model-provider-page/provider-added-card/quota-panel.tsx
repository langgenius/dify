import { InfoCircle } from '@/app/components/base/icons/src/vender/line/general'

const QuotaPanel = () => {
  return (
    <div className='group relative shrink-0 w-[112px] px-3 py-2 rounded-lg bg-white/[0.3] border-[0.5px] border-black/5'>
      <div className='flex items-center mb-2 h-4 text-xs font-medium text-gray-500'>
        QUOTA
        <InfoCircle className='ml-0.5 w-3 h-3 text-gray-400' />
      </div>
      <div className='flex items-center h-4 text-xs text-gray-500'>
        <span className='mr-0.5 text-sm font-semibold text-gray-700'>200</span>
        Call times
      </div>
      <div className={`
        absolute left-0 bottom-0 hidden group-hover:flex items-center justify-center 
        w-full h-[30px] backdrop-blur-[2px] bg-gradient-to-r from-[rgba(238,244,255,0.80)] to-[rgba(237,237,240,0.70)]
        text-xs font-medium text-primary-600 cursor-pointer rounded-b-lg
      `}>
        Buy Quota
      </div>
    </div>
  )
}

export default QuotaPanel
