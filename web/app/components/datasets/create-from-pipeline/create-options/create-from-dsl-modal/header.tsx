import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type HeaderProps = {
  onClose: () => void
}

const Header = ({
  onClose,
}: HeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="title-2xl-semi-bold relative flex items-center justify-between pb-3 pl-6 pr-14 pt-6 text-text-primary">
      {t('importFromDSL', { ns: 'app' })}
      <div
        className="absolute right-5 top-5 flex size-8 cursor-pointer items-center"
        onClick={onClose}
      >
        <RiCloseLine className="size-[18px] text-text-tertiary" />
      </div>
    </div>
  )
}

export default React.memo(Header)
