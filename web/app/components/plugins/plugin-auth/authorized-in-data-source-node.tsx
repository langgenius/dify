import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'

type AuthorizedInDataSourceNodeProps = {
  authorizationsNum: number
  onJumpToDataSourcePage: () => void
}
const AuthorizedInDataSourceNode = ({
  authorizationsNum,
  onJumpToDataSourcePage,
}: AuthorizedInDataSourceNodeProps) => {
  const { t } = useTranslation()

  return (
    <Button
      size="small"
      onClick={onJumpToDataSourcePage}
    >
      <Indicator
        className="mr-1.5"
        color="green"
      />
      {
        authorizationsNum > 1
          ? t('auth.authorizations', { ns: 'plugin' })
          : t('auth.authorization', { ns: 'plugin' })
      }
      <span className={`i-ri-equalizer-2-line ${cn(
        'h-3.5 w-3.5 text-components-button-ghost-text',
      )}`}
      />
    </Button>
  )
}

export default memo(AuthorizedInDataSourceNode)
