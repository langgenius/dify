import * as React from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  title?: string
}
const Header = ({
  title,
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col border-b-[0.5px] border-divider-regular">
      <div className="system-md-semibold flex items-center px-2 py-1.5 text-text-primary">
        {title || t('title.pickTime', { ns: 'time' })}
      </div>
    </div>
  )
}

export default React.memo(Header)
