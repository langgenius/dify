import type { FC } from 'react'
import CopyFeedback from '@/app/components/base/copy-feedback'

type CardProps = {
  log: {
    items: { role: string; text: string }[]
    isTextGeneration: boolean
  }
}
const Card: FC<CardProps> = ({
  log,
}) => {
  return (
    <>
      {
        log.isTextGeneration && (
          <div className='px-4 py-2'>
            <div className='whitespace-pre-line text-gray-700'>
              {log.items[0].text}
            </div>
          </div>
        )
      }
      {
        !log.isTextGeneration && (
          <div>
            {
              log.items.map((item, index) => (
                <div key={index} className='group/card mb-2 px-4 pt-2 pb-4 rounded-xl hover:bg-gray-50 last-of-type:mb-0'>
                  <div className='flex justify-between items-center h-8'>
                    <div className='font-semibold text-[#2D31A6]'>{item.role.toUpperCase()}</div>
                    <CopyFeedback className='hidden w-6 h-6 group-hover/card:block' content={item.text} selectorId={item.text} />
                  </div>
                  <div className='whitespace-pre-line text-gray-700'>{item.text}</div>
                </div>
              ))
            }
          </div>
        )
      }
    </>
  )
}

export default Card
