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
      <div className='mb-2.5 flex items-center py-2'>
        <div
          className='h-[1px] grow'
          style={{
            background: 'linear-gradient(270deg, #F3F4F6 0%, rgba(243, 244, 246, 0) 100%)',
          }}
        />
        <div className='flex shrink-0 items-center px-3 text-gray-500'>
          <Star04 className='mr-1 h-2.5 w-2.5' />
          <span className='text-xs font-medium text-gray-500'>{t('appDebug.feature.suggestedQuestionsAfterAnswer.tryToAsk')}</span>
        </div>
        <div
          className='h-[1px] grow'
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
              variant='secondary-accent'
              className='mb-2 mr-2 last:mr-0'
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
