import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/utils/format'

type MoreProps = {
  more: ChatItem['more']
}
const More: FC<MoreProps> = ({
  more,
}) => {
  const { t } = useTranslation()

  return (
    <div
      className="mt-1 flex items-center text-text-quaternary opacity-0 system-xs-regular group-hover:opacity-100"
      data-testid="more-container"
    >
      {
        more && (
          <>
            <div
              className="mr-2 max-w-[25%] shrink-0 truncate"
              title={`${t('detail.timeConsuming', { ns: 'appLog' })} ${more.latency}${t('detail.second', { ns: 'appLog' })}`}
              data-testid="more-latency"
            >
              {`${t('detail.timeConsuming', { ns: 'appLog' })} ${more.latency}${t('detail.second', { ns: 'appLog' })}`}
            </div>
            <div
              className="mr-2 max-w-[25%] shrink-0 truncate"
              title={`${t('detail.tokenCost', { ns: 'appLog' })} ${formatNumber(more.tokens)}`}
              data-testid="more-tokens"
            >
              {`${t('detail.tokenCost', { ns: 'appLog' })} ${formatNumber(more.tokens)}`}
            </div>
            {!!more.tokens_per_second && (
              <div
                className="mr-2 max-w-[25%] shrink-0 truncate"
                title={`${more.tokens_per_second} tokens/s`}
                data-testid="more-tps"
              >
                {`${more.tokens_per_second} tokens/s`}
              </div>
            )}
            <div className="mx-2 shrink-0">·</div>
            <div
              className="max-w-[25%] shrink-0 truncate"
              title={more.time}
              data-testid="more-time"
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
