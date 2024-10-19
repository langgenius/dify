import type { FC } from 'react'
import React from 'react'
import Script from 'next/script'
import { headers } from 'next/headers'
import { IS_CE_EDITION } from '@/config'

export enum GaType {
  admin = 'admin',
  webapp = 'webapp',
}

const gaIdMaps = {
  [GaType.admin]: 'G-DM9497FN4V',
  [GaType.webapp]: 'G-2MFWXK7WYT',
}

export type IGAProps = {
  gaType: GaType
}

const GA: FC<IGAProps> = ({
  gaType,
}) => {
  if (IS_CE_EDITION)
    return null

  const nonce = process.env.NODE_ENV === 'production' ? headers().get('x-nonce') : ''

  return (
    <>
      <Script
        strategy="beforeInteractive"
        async
        src={`https://www.googletagmanager.com/gtag/js?id=${gaIdMaps[gaType]}`}
        nonce={nonce!}
      ></Script>
      <Script
        id="ga-init"
        dangerouslySetInnerHTML={{
          __html: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaIdMaps[gaType]}');
          `,
        }}
        nonce={nonce!}
      >
      </Script>
    </>

  )
}
export default React.memo(GA)
