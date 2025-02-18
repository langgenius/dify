import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatItem } from '../../types'
import { formatNumber } from '@/utils/format'

type MoreProps = {
  more: ChatItem['more']
}
const More: FC<MoreProps> = ({
  more,
}) => {
  const { t } = useTranslation()

  return (
    <div className='mt-1 flex h-[18px] items-center text-xs text-gray-400 opacity-0 group-hover:opacity-100'>
      {
        more && (
          <>
            <div
              className='mr-2 max-w-[33.3%] shrink-0 truncate'
              title={`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}
            >
              {`${t('appLog.detail.timeConsuming')} ${more.latency}${t('appLog.detail.second')}`}
            </div>
            <div
              className='max-w-[33.3%] shrink-0 truncate'
              title={`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}
            >
              {`${t('appLog.detail.tokenCost')} ${formatNumber(more.tokens)}`}
            </div>
            <div className='mx-2 shrink-0'>·</div>
            <div
              className='max-w-[33.3%] shrink-0 truncate'
              title={more.time}
            >
              {more.time}
            </div>
          </>
        )
      }
    </div>
  )
}

export default memo(More)
