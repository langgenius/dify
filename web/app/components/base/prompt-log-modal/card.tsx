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
            <div className='text-text-secondary whitespace-pre-line'>
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
                <div key={index} className='group/card hover:bg-state-base-hover mb-2 rounded-xl px-4 pb-4 pt-2 last-of-type:mb-0'>
                  <div className='flex h-8 items-center justify-between'>
                    <div className='font-semibold text-[#2D31A6]'>{item.role.toUpperCase()}</div>
                    <CopyFeedbackNew className='hidden h-6 w-6 group-hover/card:block' content={item.text} />
                  </div>
                  <div className='text-text-secondary whitespace-pre-line'>{item.text}</div>
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
