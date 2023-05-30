import React from 'react'
import {
  InformationCircleIcon,
} from '@heroicons/react/24/outline'
import Tooltip from '../base/tooltip'
import AppIcon from '../base/app-icon'

const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_'

export function randomString(length: number) {
  let result = ''
  for (let i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
  return result
}

export type IAppBasicProps = {
  iconType?: 'app' | 'api' | 'dataset'
  icon?: string
  icon_background?: string
  name: string
  type: string | React.ReactNode
  hoverTip?: string
  textStyle?: { main?: string; extra?: string }
}

const AlgorithmSvg = <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8.5 3.5C8.5 4.60457 9.39543 5.5 10.5 5.5C11.6046 5.5 12.5 4.60457 12.5 3.5C12.5 2.39543 11.6046 1.5 10.5 1.5C9.39543 1.5 8.5 2.39543 8.5 3.5Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M12.5 9C12.5 10.1046 13.3954 11 14.5 11C15.6046 11 16.5 10.1046 16.5 9C16.5 7.89543 15.6046 7 14.5 7C13.3954 7 12.5 7.89543 12.5 9Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 3.5H5.5L3.5 6.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 14.5C8.5 15.6046 9.39543 16.5 10.5 16.5C11.6046 16.5 12.5 15.6046 12.5 14.5C12.5 13.3954 11.6046 12.5 10.5 12.5C9.39543 12.5 8.5 13.3954 8.5 14.5Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 14.5H5.5L3.5 11.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M12.5 9H1.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
</svg>

const DatasetSvg = <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M0.833497 5.13481C0.833483 4.69553 0.83347 4.31654 0.858973 4.0044C0.88589 3.67495 0.94532 3.34727 1.10598 3.03195C1.34567 2.56155 1.72812 2.17909 2.19852 1.93941C2.51384 1.77875 2.84152 1.71932 3.17097 1.6924C3.48312 1.6669 3.86209 1.66691 4.30137 1.66693L7.62238 1.66684C8.11701 1.66618 8.55199 1.66561 8.95195 1.80356C9.30227 1.92439 9.62134 2.12159 9.88607 2.38088C10.1883 2.67692 10.3823 3.06624 10.603 3.50894L11.3484 5.00008H14.3679C15.0387 5.00007 15.5924 5.00006 16.0434 5.03691C16.5118 5.07518 16.9424 5.15732 17.3468 5.36339C17.974 5.68297 18.4839 6.19291 18.8035 6.82011C19.0096 7.22456 19.0917 7.65515 19.13 8.12356C19.1668 8.57455 19.1668 9.12818 19.1668 9.79898V13.5345C19.1668 14.2053 19.1668 14.7589 19.13 15.2099C19.0917 15.6784 19.0096 16.1089 18.8035 16.5134C18.4839 17.1406 17.974 17.6505 17.3468 17.9701C16.9424 18.1762 16.5118 18.2583 16.0434 18.2966C15.5924 18.3334 15.0387 18.3334 14.3679 18.3334H5.63243C4.96163 18.3334 4.40797 18.3334 3.95698 18.2966C3.48856 18.2583 3.05798 18.1762 2.65353 17.9701C2.02632 17.6505 1.51639 17.1406 1.19681 16.5134C0.990734 16.1089 0.908597 15.6784 0.870326 15.2099C0.833478 14.7589 0.833487 14.2053 0.833497 13.5345V5.13481ZM7.51874 3.33359C8.17742 3.33359 8.30798 3.34447 8.4085 3.37914C8.52527 3.41942 8.63163 3.48515 8.71987 3.57158C8.79584 3.64598 8.86396 3.7579 9.15852 4.34704L9.48505 5.00008L2.50023 5.00008C2.50059 4.61259 2.50314 4.34771 2.5201 4.14012C2.5386 3.91374 2.57 3.82981 2.59099 3.7886C2.67089 3.6318 2.79837 3.50432 2.95517 3.42442C2.99638 3.40343 3.08031 3.37203 3.30669 3.35353C3.54281 3.33424 3.85304 3.33359 4.3335 3.33359H7.51874Z" fill="#444CE7" />
</svg>

const ICON_MAP = {
  app: <AppIcon className='border !border-[rgba(0,0,0,0.05)]' />,
  api: <AppIcon innerIcon={AlgorithmSvg} className='border !bg-purple-50 !border-purple-200' />,
  dataset: <AppIcon innerIcon={DatasetSvg} className='!border-[0.5px] !border-indigo-100 !bg-indigo-25' />,
}

export default function AppBasic({ icon, icon_background, name, type, hoverTip, textStyle, iconType = 'app' }: IAppBasicProps) {
  return (
    <div className="flex items-start">
      {icon && icon_background && iconType === 'app' && (
        <div className='flex-shrink-0 mr-3'>
          <AppIcon icon={icon} background={icon_background} />
        </div>
      )}
      {iconType !== 'app'
        && <div className='flex-shrink-0 mr-3'>
          {ICON_MAP[iconType]}
        </div>

      }
      <div className="group">
        <div className={`flex flex-row items-center text-sm font-semibold text-gray-700 group-hover:text-gray-900 ${textStyle?.main}`}>
          {name}
          {hoverTip
            && <Tooltip content={hoverTip} selector={`a${randomString(16)}`}>
              <InformationCircleIcon className='w-4 h-4 ml-1 text-gray-400' />
            </Tooltip>}
        </div>
        <div className={`text-xs font-normal text-gray-500 group-hover:text-gray-700 ${textStyle?.extra}`}>{type}</div>
      </div>
    </div>
  )
}
