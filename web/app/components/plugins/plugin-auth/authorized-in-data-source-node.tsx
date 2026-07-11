import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { RiEqualizer2Line } from '@remixicon/react'
import {
  memo,
} from 'react'
import { useTranslation } from 'react-i18next'

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
      <StatusDot
        className="mr-1.5"
        status="success"
      />
      {
        authorizationsNum > 1
          ? t($ => $['auth.authorizations'], { ns: 'plugin' })
          : t($ => $['auth.authorization'], { ns: 'plugin' })
      }
      <RiEqualizer2Line
        className={cn(
          'size-3.5 text-components-button-ghost-text',
        )}
      />
    </Button>
  )
}

export default memo(AuthorizedInDataSourceNode)
