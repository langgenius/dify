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
    <div className='px-4 py-2'>
      {
        log.isTextGeneration && (
          <div>
            {log.items[0].text}
          </div>
        )
      }
      {
        !log.isTextGeneration && (
          log.items.map((item, index) => (
            <div key={index}>
              <div className='flex justify-between items-center h-8'>
                <div className='font-semibold text-[#2D31A6]'>{item.role}</div>
                <CopyFeedback className='w-6 h-6' content='' selectorId='' />
              </div>
              <div>{item.text}</div>
            </div>
          ))
        )
      }
    </div>
  )
}

export default Card
