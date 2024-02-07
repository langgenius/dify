import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { OnSend } from '../types'
import { Star04 } from '@/app/components/base/icons/src/vender/solid/shapes'
import Button from '@/app/components/base/button'

type TryToAskProps = {
  suggestedQuestions: string[]
  onSend: OnSend
}
const TryToAsk: FC<TryToAskProps> = ({
  suggestedQuestions,
  onSend,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className='flex items-center mb-2.5 py-2'>
        <div
          className='grow h-[1px]'
          style={{
            background: 'linear-gradient(270deg, #F3F4F6 0%, rgba(243, 244, 246, 0) 100%)',
          }}
        />
        <div className='shrink-0 flex items-center px-3 text-gray-500'>
          <Star04 className='mr-1 w-2.5 h-2.5' />
          <span className='text-xs text-gray-500 font-medium'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.tryToAsk')}</span>
        </div>
        <div
          className='grow h-[1px]'
          style={{
            background: 'linear-gradient(270deg, rgba(243, 244, 246, 0) 0%, #F3F4F6 100%)',
          }}
        />
      </div>
      <div className='flex flex-wrap justify-center'>
        {
          suggestedQuestions.map((suggestQuestion, index) => (
            <Button
              key={index}
              className='mb-2 mr-2 last:mr-0 px-3 py-[5px] bg-white text-primary-600 text-xs font-medium'
              onClick={() => onSend(suggestQuestion)}
            >
              {suggestQuestion}
            </Button>
          ))
        }
      </div>
    </div>
  )
}

export default memo(TryToAsk)
