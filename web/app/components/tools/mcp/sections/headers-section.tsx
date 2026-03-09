'use client'
import type { FC } from 'react'
import type { HeaderItem } from '../headers-input'
import { useTranslation } from 'react-i18next'
import HeadersInput from '../headers-input'

type HeadersSectionProps = {
  headers: HeaderItem[]
  onHeadersChange: (headers: HeaderItem[]) => void
  isCreate: boolean
}

const HeadersSection: FC<HeadersSectionProps> = ({
  headers,
  onHeadersChange,
  isCreate,
}) => {
  const { t } = useTranslation()

  return (
    <div>
      <div className="mb-1 flex h-6 items-center">
        <span className="text-text-secondary system-sm-medium">{t('mcp.modal.headers', { ns: 'tools' })}</span>
      </div>
      <div className="mb-2 text-text-tertiary body-xs-regular">{t('mcp.modal.headersTip', { ns: 'tools' })}</div>
      <HeadersInput
        headersItems={headers}
        onChange={onHeadersChange}
        readonly={false}
        isMasked={!isCreate && headers.filter(item => item.key.trim()).length > 0}
      />
    </div>
  )
}

export default HeadersSection
