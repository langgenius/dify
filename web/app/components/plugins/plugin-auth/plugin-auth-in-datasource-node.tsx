import type { ReactNode } from 'react'
import { RiAddLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'

type PluginAuthInDataSourceNodeProps = {
  children?: ReactNode
  isAuthorized?: boolean
  onJumpToDataSourcePage: () => void
}
const PluginAuthInDataSourceNode = ({
  children,
  isAuthorized,
  onJumpToDataSourcePage,
}: PluginAuthInDataSourceNodeProps) => {
  const { t } = useTranslation()
  return (
    <>
      {
        !isAuthorized && (
          <div className="px-4 pb-2">
            <Button
              className="w-full"
              variant="primary"
              onClick={onJumpToDataSourcePage}
            >
              <RiAddLine className="mr-1 h-4 w-4" />
              {t('integrations.connect', { ns: 'common' })}
            </Button>
          </div>
        )
      }
      {isAuthorized && children}
    </>
  )
}

export default memo(PluginAuthInDataSourceNode)
