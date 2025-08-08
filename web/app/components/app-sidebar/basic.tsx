import React from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '../base/app-icon'
import Tooltip from '@/app/components/base/tooltip'
import {
  Code,
  WindowCursor,
} from '@/app/components/base/icons/src/vender/workflow'

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
  hideType?: boolean
}

const DatasetSvg = <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fillRule="evenodd" clipRule="evenodd" d="M0.833497 5.13481C0.833483 4.69553 0.83347 4.31654 0.858973 4.0044C0.88589 3.67495 0.94532 3.34727 1.10598 3.03195C1.34567 2.56155 1.72812 2.17909 2.19852 1.93941C2.51384 1.77875 2.84152 1.71932 3.17097 1.6924C3.48312 1.6669 3.86209 1.66691 4.30137 1.66693L7.62238 1.66684C8.11701 1.66618 8.55199 1.66561 8.95195 1.80356C9.30227 1.92439 9.62134 2.12159 9.88607 2.38088C10.1883 2.67692 10.3823 3.06624 10.603 3.50894L11.3484 5.00008H14.3679C15.0387 5.00007 15.5924 5.00006 16.0434 5.03691C16.5118 5.07518 16.9424 5.15732 17.3468 5.36339C17.974 5.68297 18.4839 6.19291 18.8035 6.82011C19.0096 7.22456 19.0917 7.65515 19.13 8.12356C19.1668 8.57455 19.1668 9.12818 19.1668 9.79898V13.5345C19.1668 14.2053 19.1668 14.7589 19.13 15.2099C19.0917 15.6784 19.0096 16.1089 18.8035 16.5134C18.4839 17.1406 17.974 17.6505 17.3468 17.9701C16.9424 18.1762 16.5118 18.2583 16.0434 18.2966C15.5924 18.3334 15.0387 18.3334 14.3679 18.3334H5.63243C4.96163 18.3334 4.40797 18.3334 3.95698 18.2966C3.48856 18.2583 3.05798 18.1762 2.65353 17.9701C2.02632 17.6505 1.51639 17.1406 1.19681 16.5134C0.990734 16.1089 0.908597 15.6784 0.870326 15.2099C0.833478 14.7589 0.833487 14.2053 0.833497 13.5345V5.13481ZM7.51874 3.33359C8.17742 3.33359 8.30798 3.34447 8.4085 3.37914C8.52527 3.41942 8.63163 3.48515 8.71987 3.57158C8.79584 3.64598 8.86396 3.7579 9.15852 4.34704L9.48505 5.00008L2.50023 5.00008C2.50059 4.61259 2.50314 4.34771 2.5201 4.14012C2.5386 3.91374 2.57 3.82981 2.59099 3.7886C2.67089 3.6318 2.79837 3.50432 2.95517 3.42442C2.99638 3.40343 3.08031 3.37203 3.30669 3.35353C3.54281 3.33424 3.85304 3.33359 4.3335 3.33359H7.51874Z" fill="#444CE7" />
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
  api: <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-500 p-1 shadow-md'>
    <Code className='h-4 w-4 text-text-primary-on-surface' />
  </div>,
  dataset: <AppIcon innerIcon={DatasetSvg} className='!border-[0.5px] !border-indigo-100 !bg-indigo-25' />,
  webapp: <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 p-1 shadow-md'>
  <WindowCursor className='h-4 w-4 text-text-primary-on-surface' />
</div>,
  notion: <AppIcon innerIcon={NotionSvg} className='!border-[0.5px] !border-indigo-100 !bg-white' />,
}

export default function AppBasic({ icon, icon_background, name, isExternal, type, hoverTip, textStyle, isExtraInLine, mode = 'expand', iconType = 'app', hideType }: IAppBasicProps) {
  const { t } = useTranslation()

  return (
    <div className="flex grow items-center">
      {icon && icon_background && iconType === 'app' && (
        <div className='mr-3 shrink-0'>
          <AppIcon icon={icon} background={icon_background} />
        </div>
      )}
      {iconType !== 'app'
        && <div className='mr-3 shrink-0'>
          {ICON_MAP[iconType]}
        </div>

      }
      {mode === 'expand' && <div className="group w-full">
        <div className={`system-md-semibold flex flex-row items-center text-text-secondary group-hover:text-text-primary ${textStyle?.main ?? ''}`}>
          <div className="min-w-0 overflow-hidden text-ellipsis break-normal">
            {name}
          </div>
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
        {!hideType && isExtraInLine && (
          <div className="system-2xs-medium-uppercase flex text-text-tertiary">{type}</div>
        )}
        {!hideType && !isExtraInLine && (
          <div className='system-2xs-medium-uppercase text-text-tertiary'>{isExternal ? t('dataset.externalTag') : type}</div>
        )}
      </div>}
    </div>
  )
}
