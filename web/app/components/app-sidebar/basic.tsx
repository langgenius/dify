import React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../base/app-icon'
import Tooltip from '@/app/components/base/tooltip'

export type IAppBasicProps = {
  iconType?: 'app' | 'api' | 'dataset' | 'webapp' | 'notion'
  icon?: string
  icon_background?: string | null
  isExternal?: boolean
  name: string
  type: string | React.ReactNode
  hoverTip?: string
  textStyle?: { main?: string; extra?: string }
  isExtraInLine?: boolean
  mode?: string
}

const ApiSvg = <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M8.5 3.5C8.5 4.60457 9.39543 5.5 10.5 5.5C11.6046 5.5 12.5 4.60457 12.5 3.5C12.5 2.39543 11.6046 1.5 10.5 1.5C9.39543 1.5 8.5 2.39543 8.5 3.5Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M12.5 9C12.5 10.1046 13.3954 11 14.5 11C15.6046 11 16.5 10.1046 16.5 9C16.5 7.89543 15.6046 7 14.5 7C13.3954 7 12.5 7.89543 12.5 9Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 3.5H5.5L3.5 6.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 14.5C8.5 15.6046 9.39543 16.5 10.5 16.5C11.6046 16.5 12.5 15.6046 12.5 14.5C12.5 13.3954 11.6046 12.5 10.5 12.5C9.39543 12.5 8.5 13.3954 8.5 14.5Z" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M8.5 14.5H5.5L3.5 11.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  <path d="M12.5 9H1.5" stroke="#5850EC" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
</svg>

const DatasetSvg = <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fillRule="evenodd" clipRule="evenodd" d="M0.833497 5.13481C0.833483 4.69553 0.83347 4.31654 0.858973 4.0044C0.88589 3.67495 0.94532 3.34727 1.10598 3.03195C1.34567 2.56155 1.72812 2.17909 2.19852 1.93941C2.51384 1.77875 2.84152 1.71932 3.17097 1.6924C3.48312 1.6669 3.86209 1.66691 4.30137 1.66693L7.62238 1.66684C8.11701 1.66618 8.55199 1.66561 8.95195 1.80356C9.30227 1.92439 9.62134 2.12159 9.88607 2.38088C10.1883 2.67692 10.3823 3.06624 10.603 3.50894L11.3484 5.00008H14.3679C15.0387 5.00007 15.5924 5.00006 16.0434 5.03691C16.5118 5.07518 16.9424 5.15732 17.3468 5.36339C17.974 5.68297 18.4839 6.19291 18.8035 6.82011C19.0096 7.22456 19.0917 7.65515 19.13 8.12356C19.1668 8.57455 19.1668 9.12818 19.1668 9.79898V13.5345C19.1668 14.2053 19.1668 14.7589 19.13 15.2099C19.0917 15.6784 19.0096 16.1089 18.8035 16.5134C18.4839 17.1406 17.974 17.6505 17.3468 17.9701C16.9424 18.1762 16.5118 18.2583 16.0434 18.2966C15.5924 18.3334 15.0387 18.3334 14.3679 18.3334H5.63243C4.96163 18.3334 4.40797 18.3334 3.95698 18.2966C3.48856 18.2583 3.05798 18.1762 2.65353 17.9701C2.02632 17.6505 1.51639 17.1406 1.19681 16.5134C0.990734 16.1089 0.908597 15.6784 0.870326 15.2099C0.833478 14.7589 0.833487 14.2053 0.833497 13.5345V5.13481ZM7.51874 3.33359C8.17742 3.33359 8.30798 3.34447 8.4085 3.37914C8.52527 3.41942 8.63163 3.48515 8.71987 3.57158C8.79584 3.64598 8.86396 3.7579 9.15852 4.34704L9.48505 5.00008L2.50023 5.00008C2.50059 4.61259 2.50314 4.34771 2.5201 4.14012C2.5386 3.91374 2.57 3.82981 2.59099 3.7886C2.67089 3.6318 2.79837 3.50432 2.95517 3.42442C2.99638 3.40343 3.08031 3.37203 3.30669 3.35353C3.54281 3.33424 3.85304 3.33359 4.3335 3.33359H7.51874Z" fill="#444CE7" />
</svg>

const WebappSvg = <svg width="16" height="18" viewBox="0 0 16 18" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14.375 5.45825L7.99998 8.99992M7.99998 8.99992L1.62498 5.45825M7.99998 8.99992L8 16.1249M14.75 12.0439V5.95603C14.75 5.69904 14.75 5.57055 14.7121 5.45595C14.6786 5.35457 14.6239 5.26151 14.5515 5.18299C14.4697 5.09424 14.3574 5.03184 14.1328 4.90704L8.58277 1.8237C8.37007 1.70553 8.26372 1.64645 8.15109 1.62329C8.05141 1.60278 7.9486 1.60278 7.84891 1.62329C7.73628 1.64645 7.62993 1.70553 7.41723 1.8237L1.86723 4.90704C1.64259 5.03184 1.53026 5.09424 1.44847 5.18299C1.37612 5.26151 1.32136 5.35457 1.28786 5.45595C1.25 5.57055 1.25 5.69904 1.25 5.95603V12.0439C1.25 12.3008 1.25 12.4293 1.28786 12.5439C1.32136 12.6453 1.37612 12.7384 1.44847 12.8169C1.53026 12.9056 1.64259 12.968 1.86723 13.0928L7.41723 16.1762C7.62993 16.2943 7.73628 16.3534 7.84891 16.3766C7.9486 16.3971 8.05141 16.3971 8.15109 16.3766C8.26372 16.3534 8.37007 16.2943 8.58277 16.1762L14.1328 13.0928C14.3574 12.968 14.4697 12.9056 14.5515 12.8169C14.6239 12.7384 14.6786 12.6453 14.7121 12.5439C14.75 12.4293 14.75 12.3008 14.75 12.0439Z" stroke="#155EEF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
</svg>

const NotionSvg = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g clipPath="url(#clip0_6294_13848)">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M4.287 21.9133L1.70748 18.6999C1.08685 17.9267 0.75 16.976 0.75 15.9974V4.36124C0.75 2.89548 1.92269 1.67923 3.43553 1.57594L15.3991 0.759137C16.2682 0.699797 17.1321 0.930818 17.8461 1.41353L22.0494 4.25543C22.8018 4.76414 23.25 5.59574 23.25 6.48319V19.7124C23.25 21.1468 22.0969 22.3345 20.6157 22.4256L7.3375 23.243C6.1555 23.3158 5.01299 22.8178 4.287 21.9133Z" fill="white" />
    <path d="M8.43607 10.1842V10.0318C8.43607 9.64564 8.74535 9.32537 9.14397 9.29876L12.0475 9.10491L16.0628 15.0178V9.82823L15.0293 9.69046V9.6181C15.0293 9.22739 15.3456 8.90501 15.7493 8.88433L18.3912 8.74899V9.12918C18.3912 9.30765 18.2585 9.46031 18.0766 9.49108L17.4408 9.59861V18.0029L16.6429 18.2773C15.9764 18.5065 15.2343 18.2611 14.8527 17.6853L10.9545 11.803V17.4173L12.1544 17.647L12.1377 17.7583C12.0853 18.1069 11.7843 18.3705 11.4202 18.3867L8.43607 18.5195C8.39662 18.1447 8.67758 17.8093 9.06518 17.7686L9.45771 17.7273V10.2416L8.43607 10.1842Z" fill="black" />
    <path fill-rule="evenodd" clip-rule="evenodd" d="M15.5062 2.22521L3.5426 3.04201C2.82599 3.09094 2.27051 3.66706 2.27051 4.36136V15.9975C2.27051 16.6499 2.49507 17.2837 2.90883 17.7992L5.48835 21.0126C5.90541 21.5322 6.56174 21.8183 7.24076 21.7765L20.519 20.9591C21.1995 20.9172 21.7293 20.3716 21.7293 19.7125V6.48332C21.7293 6.07557 21.5234 5.69348 21.1777 5.45975L16.9743 2.61784C16.546 2.32822 16.0277 2.1896 15.5062 2.22521ZM4.13585 4.54287C3.96946 4.41968 4.04865 4.16303 4.25768 4.14804L15.5866 3.33545C15.9476 3.30956 16.3063 3.40896 16.5982 3.61578L18.8713 5.22622C18.9576 5.28736 18.9171 5.41935 18.8102 5.42516L6.8129 6.07764C6.44983 6.09739 6.09144 5.99073 5.80276 5.77699L4.13585 4.54287ZM6.25018 8.12315C6.25018 7.7334 6.56506 7.41145 6.9677 7.38952L19.6523 6.69871C20.0447 6.67734 20.375 6.97912 20.375 7.35898V18.8141C20.375 19.2031 20.0613 19.5247 19.6594 19.5476L7.05516 20.2648C6.61845 20.2896 6.25018 19.954 6.25018 19.5312V8.12315Z" fill="black" />
  </g>
  <defs>
    <clipPath id="clip0_6294_13848">
      <rect width="24" height="24" fill="white" />
    </clipPath>
  </defs>
</svg>

const ICON_MAP = {
  app: <AppIcon className='border !border-[rgba(0,0,0,0.05)]' />,
  api: <AppIcon innerIcon={ApiSvg} className='border !bg-purple-50 !border-purple-200' />,
  dataset: <AppIcon innerIcon={DatasetSvg} className='!border-[0.5px] !border-indigo-100 !bg-indigo-25' />,
  webapp: <AppIcon innerIcon={WebappSvg} className='border !bg-primary-100 !border-primary-200' />,
  notion: <AppIcon innerIcon={NotionSvg} className='!border-[0.5px] !border-indigo-100 !bg-white' />,
}

export default function AppBasic({ icon, icon_background, name, isExternal, type, hoverTip, textStyle, mode = 'expand', iconType = 'app' }: IAppBasicProps) {
  const { t } = useTranslation()

  return (
    <div className="flex items-start p-1">
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
      {mode === 'expand' && <div className="group">
        <div className={`flex flex-row items-center text-sm font-semibold text-gray-700 group-hover:text-gray-900 break-all ${textStyle?.main ?? ''}`}>
          {name}
          {hoverTip
            && <Tooltip
              popupContent={
                <div className='w-[240px]'>
                  {hoverTip}
                </div>
              }
              popupClassName='ml-1'
              triggerClassName='w-4 h-4 ml-1'
              position='top'
            />
          }
        </div>
        <div className={`text-xs font-normal text-gray-500 group-hover:text-gray-700 break-all ${textStyle?.extra ?? ''}`}>{type}</div>
        <div className='text-text-tertiary system-2xs-medium-uppercase'>{isExternal ? t('dataset.externalTag') : ''}</div>
      </div>}
    </div>
  )
}
