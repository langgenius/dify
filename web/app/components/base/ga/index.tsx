import type { FC } from 'react'
import React from 'react'
import Script from 'next/script'
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

  return (
    <>
      <Script strategy="beforeInteractive" async src={`https://www.googletagmanager.com/gtag/js?id=${gaIdMaps[gaType]}`}></Script>
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
      >
      </Script>
      {gaType === GaType.admin && (
        <>
          <Script strategy="beforeInteractive" async src={'https://www.googletagmanager.com/gtag/js?id=AW-11217955271"}'}></Script>
          <Script
            id="ga-monitor-register"
            dangerouslySetInnerHTML={{
              __html: `
window.dataLayer2 = window.dataLayer2 || [];
function gtag(){dataLayer2.push(arguments);}
gtag('js', new Date());
gtag('config', 'AW-11217955271"');
          `,
            }}
          >
          </Script>
        </>
      )}
    </>

  )
}
export default React.memo(GA)
