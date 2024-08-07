import type { FC } from 'react'
import { CopyFeedbackNew } from '@/app/components/base/copy-feedback'

type CardProps = {
  log: { role: string; text: string }[]
}
const Card: FC<CardProps> = ({
  log,
}) => {
  return (
    <>
      {
        log.length === 1 && (
          <div className='px-4 py-2'>
            <div className='whitespace-pre-line text-gray-700'>
              {log[0].text}
            </div>
          </div>
        )
      }
      {
        log.length > 1 && (
          <div>
            {
              log.map((item, index) => (
                <div key={index} className='group/card mb-2 px-4 pt-2 pb-4 rounded-xl hover:bg-gray-50 last-of-type:mb-0'>
                  <div className='flex justify-between items-center h-8'>
                    <div className='font-semibold text-[#2D31A6]'>{item.role.toUpperCase()}</div>
                    <CopyFeedbackNew className='hidden w-6 h-6 group-hover/card:block' content={item.text} />
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
