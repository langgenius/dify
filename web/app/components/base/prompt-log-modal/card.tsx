import CopyFeedback from '@/app/components/base/copy-feedback'

const Card = () => {
  return (
    <div className='px-4 py-2'>
      <div className='flex justify-between items-center h-8'>
        <div className='font-semibold text-[#2D31A6]'>SYSTEM</div>
        <CopyFeedback className='w-6 h-6' content='' selectorId='' />
      </div>
      <div></div>
    </div>
  )
}

export default Card
