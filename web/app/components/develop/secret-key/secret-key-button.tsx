'use client'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import SecretKeyModal from '@/app/components/develop/secret-key/secret-key-modal'
// import { KeyIcon } from '@heroicons/react/20/solid'

type ISecretKeyButtonProps = {
  className?: string
  appId?: string
  iconCls?: string
  textCls?: string
}

const SecretKeyButton = ({ className, appId, iconCls, textCls }: ISecretKeyButtonProps) => {
  const [isVisible, setVisible] = useState(false)
  const { t } = useTranslation()
  return (
    <>
      <Button className={`px-3 ${className}`} onClick={() => setVisible(true)}>
        <div className={'flex items-center justify-center w-4 h-4 mr-2'}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={iconCls}>
            <path d="M9 3.66672C9.35362 3.66672 9.69276 3.80719 9.94281 4.05724C10.1929 4.30729 10.3333 4.64643 10.3333 5.00005M13 5.00005C13.0002 5.62483 12.854 6.24097 12.5732 6.79908C12.2924 7.3572 11.8847 7.84177 11.3829 8.21397C10.8811 8.58617 10.2991 8.83564 9.68347 8.94239C9.06788 9.04915 8.43584 9.01022 7.838 8.82872L6.33333 10.3334H5V11.6667H3.66667V13.0001H1.66667C1.48986 13.0001 1.32029 12.9298 1.19526 12.8048C1.07024 12.6798 1 12.5102 1 12.3334V10.6094C1.00004 10.4326 1.0703 10.263 1.19533 10.1381L5.17133 6.16205C5.00497 5.61206 4.95904 5.03268 5.0367 4.46335C5.11435 3.89402 5.31375 3.3481 5.62133 2.86275C5.92891 2.3774 6.33744 1.96401 6.81913 1.65073C7.30082 1.33745 7.84434 1.13162 8.41272 1.04725C8.9811 0.96289 9.56098 1.00197 10.1129 1.16184C10.6648 1.32171 11.1758 1.59861 11.6111 1.97369C12.0464 2.34878 12.3958 2.81324 12.6354 3.33548C12.8751 3.85771 12.9994 4.42545 13 5.00005Z" stroke="#1F2A37" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className={`text-[13px] text-gray-800 ${textCls}`}>{t('appApi.apiKey')}</div>
      </Button>
      <SecretKeyModal isShow={isVisible} onClose={() => setVisible(false)} appId={appId} />
    </>
  )
}

export default SecretKeyButton
