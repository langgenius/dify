'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from '#i18n'

type PageUnavailableProps = {
  className?: string
}

const PageUnavailable = ({ className }: PageUnavailableProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('flex h-screen w-screen items-center justify-center', className)}>
      <h1
        className="mr-5 h-[50px] shrink-0 pr-5 text-[24px] leading-[50px] font-medium"
        style={{
          borderRight: '1px solid rgba(0,0,0,.3)',
        }}
      >
        404
      </h1>
      <div className="text-sm">{t('pageUnavailable', { ns: 'common' })}</div>
    </div>
  )
}

export default PageUnavailable
