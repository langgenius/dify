'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { useSelectedLayoutSegments } from 'next/navigation'
import Link from 'next/link'
import Toast from '../../base/toast'
import Item from './app-nav-item'
import cn from '@/utils/classnames'
import { fetchInstalledAppList as doFetchInstalledAppList, uninstallApp, updatePinStatus } from '@/service/explore'
import ExploreContext from '@/context/explore-context'
import Confirm from '@/app/components/base/confirm'
import Divider from '@/app/components/base/divider'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

const SelectedDiscoveryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M13.4135 1.11725C13.5091 1.09983 13.6483 1.08355 13.8078 1.11745C14.0143 1.16136 14.2017 1.26953 14.343 1.42647C14.4521 1.54766 14.5076 1.67634 14.5403 1.76781C14.5685 1.84673 14.593 1.93833 14.6136 2.01504L15.5533 5.5222C15.5739 5.5989 15.5985 5.69049 15.6135 5.77296C15.6309 5.86852 15.6472 6.00771 15.6133 6.16722C15.5694 6.37378 15.4612 6.56114 15.3043 6.70245C15.1831 6.81157 15.0544 6.86706 14.9629 6.89975C14.884 6.92796 14.7924 6.95247 14.7157 6.97299L14.676 6.98364C14.3365 7.07461 14.0437 7.15309 13.7972 7.19802C13.537 7.24543 13.2715 7.26736 12.9946 7.20849C12.7513 7.15677 12.5213 7.06047 12.3156 6.92591L9.63273 7.64477C9.86399 7.97104 9.99992 8.36965 9.99992 8.80001C9.99992 9.2424 9.85628 9.65124 9.6131 9.98245L12.5508 14.291C12.7582 14.5952 12.6797 15.01 12.3755 15.2174C12.0713 15.4248 11.6566 15.3464 11.4492 15.0422L8.51171 10.7339C8.34835 10.777 8.17682 10.8 7.99992 10.8C7.82305 10.8 7.65155 10.777 7.48823 10.734L4.5508 15.0422C4.34338 15.3464 3.92863 15.4248 3.62442 15.2174C3.32021 15.01 3.24175 14.5952 3.44916 14.291L6.3868 9.98254C6.14358 9.65132 5.99992 9.24244 5.99992 8.80001C5.99992 8.73795 6.00274 8.67655 6.00827 8.61594L4.59643 8.99424C4.51973 9.01483 4.42813 9.03941 4.34567 9.05444C4.25011 9.07185 4.11092 9.08814 3.95141 9.05423C3.74485 9.01033 3.55748 8.90215 3.41618 8.74522C3.38535 8.71097 3.3588 8.67614 3.33583 8.64171L2.49206 8.8678C2.41536 8.88838 2.32376 8.91296 2.2413 8.92799C2.14574 8.94541 2.00655 8.96169 1.84704 8.92779C1.64048 8.88388 1.45311 8.77571 1.31181 8.61877C1.20269 8.49759 1.1472 8.3689 1.1145 8.27744C1.08629 8.1985 1.06177 8.10689 1.04125 8.03018L0.791701 7.09885C0.771119 7.02215 0.746538 6.93055 0.731508 6.84809C0.714092 6.75253 0.697808 6.61334 0.731712 6.45383C0.775619 6.24726 0.883793 6.0599 1.04073 5.9186C1.16191 5.80948 1.2906 5.75399 1.38206 5.72129C1.461 5.69307 1.55261 5.66856 1.62932 5.64804L2.47318 5.42193C2.47586 5.38071 2.48143 5.33735 2.49099 5.29237C2.5349 5.08581 2.64307 4.89844 2.80001 4.75714C2.92119 4.64802 3.04988 4.59253 3.14134 4.55983C3.22027 4.53162 3.31189 4.50711 3.3886 4.48658L11.1078 2.41824C11.2186 2.19888 11.3697 2.00049 11.5545 1.83406C11.7649 1.64462 12.0058 1.53085 12.2548 1.44183C12.4907 1.35749 12.7836 1.27904 13.123 1.18809L13.1628 1.17744C13.2395 1.15686 13.3311 1.13228 13.4135 1.11725ZM13.3642 2.5039C13.0648 2.58443 12.8606 2.64126 12.7036 2.69735C12.5325 2.75852 12.4742 2.80016 12.4467 2.82492C12.3421 2.91912 12.2699 3.04403 12.2407 3.18174C12.233 3.21793 12.2261 3.28928 12.2587 3.46805C12.2927 3.6545 12.3564 3.89436 12.4559 4.26563L12.5594 4.652C12.6589 5.02328 12.7236 5.26287 12.7874 5.44133C12.8486 5.61244 12.8902 5.67079 12.915 5.69829C13.0092 5.80291 13.1341 5.87503 13.2718 5.9043C13.308 5.91199 13.3793 5.91887 13.5581 5.88629C13.7221 5.85641 13.9273 5.80352 14.2269 5.72356L13.3642 2.5039Z" fill="#155EEF" />
  </svg>
)

const DiscoveryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8.74786 9.89676L12.0003 14.6669M7.25269 9.89676L4.00027 14.6669M9.3336 8.80031C9.3336 9.53669 8.73665 10.1336 8.00027 10.1336C7.26389 10.1336 6.66694 9.53669 6.66694 8.80031C6.66694 8.06393 7.26389 7.46698 8.00027 7.46698C8.73665 7.46698 9.3336 8.06393 9.3336 8.80031ZM11.4326 3.02182L3.57641 5.12689C3.39609 5.1752 3.30593 5.19936 3.24646 5.25291C3.19415 5.30001 3.15809 5.36247 3.14345 5.43132C3.12681 5.5096 3.15097 5.59976 3.19929 5.78008L3.78595 7.96951C3.83426 8.14984 3.85842 8.24 3.91197 8.29947C3.95907 8.35178 4.02153 8.38784 4.09038 8.40248C4.16866 8.41911 4.25882 8.39496 4.43914 8.34664L12.2953 6.24158L11.4326 3.02182ZM14.5285 6.33338C13.8072 6.52665 13.4466 6.62328 13.1335 6.55673C12.8581 6.49819 12.6082 6.35396 12.4198 6.14471C12.2056 5.90682 12.109 5.54618 11.9157 4.82489L11.8122 4.43852C11.6189 3.71722 11.5223 3.35658 11.5889 3.04347C11.6474 2.76805 11.7916 2.51823 12.0009 2.32982C12.2388 2.11563 12.5994 2.019 13.3207 1.82573C13.501 1.77741 13.5912 1.75325 13.6695 1.76989C13.7383 1.78452 13.8008 1.82058 13.8479 1.87289C13.9014 1.93237 13.9256 2.02253 13.9739 2.20285L14.9057 5.68018C14.954 5.86051 14.9781 5.95067 14.9615 6.02894C14.9469 6.0978 14.9108 6.16025 14.8585 6.20736C14.799 6.2609 14.7088 6.28506 14.5285 6.33338ZM2.33475 8.22033L3.23628 7.97876C3.4166 7.93044 3.50676 7.90628 3.56623 7.85274C3.61854 7.80563 3.6546 7.74318 3.66924 7.67433C3.68588 7.59605 3.66172 7.50589 3.6134 7.32556L3.37184 6.42403C3.32352 6.24371 3.29936 6.15355 3.24581 6.09408C3.19871 6.04176 3.13626 6.00571 3.0674 5.99107C2.98912 5.97443 2.89896 5.99859 2.71864 6.04691L1.81711 6.28847C1.63678 6.33679 1.54662 6.36095 1.48715 6.4145C1.43484 6.4616 1.39878 6.52405 1.38415 6.59291C1.36751 6.67119 1.39167 6.76135 1.43998 6.94167L1.68155 7.8432C1.72987 8.02352 1.75402 8.11369 1.80757 8.17316C1.85467 8.22547 1.91713 8.26153 1.98598 8.27616C2.06426 8.2928 2.15442 8.26864 2.33475 8.22033Z" stroke="#344054" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const SelectedChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M8.00016 1.3335C4.31826 1.3335 1.3335 4.31826 1.3335 8.00016C1.3335 8.88571 1.50651 9.7325 1.8212 10.5074C1.84962 10.5773 1.86597 10.6178 1.87718 10.6476L1.88058 10.6568L1.88016 10.66C1.87683 10.6846 1.87131 10.7181 1.86064 10.7821L1.46212 13.1732C1.44424 13.2803 1.42423 13.4001 1.41638 13.5041C1.40782 13.6176 1.40484 13.7981 1.48665 13.9888C1.58779 14.2246 1.77569 14.4125 2.0115 14.5137C2.20224 14.5955 2.38274 14.5925 2.49619 14.5839C2.60025 14.5761 2.72006 14.5561 2.82715 14.5382L5.2182 14.1397C5.28222 14.129 5.31576 14.1235 5.34036 14.1202L5.34353 14.1197L5.35274 14.1231C5.38258 14.1344 5.42298 14.1507 5.49297 14.1791C6.26783 14.4938 7.11462 14.6668 8.00016 14.6668C11.6821 14.6668 14.6668 11.6821 14.6668 8.00016C14.6668 4.31826 11.6821 1.3335 8.00016 1.3335ZM4.00016 8.00016C4.00016 7.44788 4.44788 7.00016 5.00016 7.00016C5.55245 7.00016 6.00016 7.44788 6.00016 8.00016C6.00016 8.55245 5.55245 9.00016 5.00016 9.00016C4.44788 9.00016 4.00016 8.55245 4.00016 8.00016ZM7.00016 8.00016C7.00016 7.44788 7.44788 7.00016 8.00016 7.00016C8.55245 7.00016 9.00016 7.44788 9.00016 8.00016C9.00016 8.55245 8.55245 9.00016 8.00016 9.00016C7.44788 9.00016 7.00016 8.55245 7.00016 8.00016ZM11.0002 7.00016C10.4479 7.00016 10.0002 7.44788 10.0002 8.00016C10.0002 8.55245 10.4479 9.00016 11.0002 9.00016C11.5524 9.00016 12.0002 8.55245 12.0002 8.00016C12.0002 7.44788 11.5524 7.00016 11.0002 7.00016Z" fill="#155EEF" />
  </svg>
)

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 8H5.00667M8 8H8.00667M11 8H11.0067M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 8.7981 2.15582 9.5598 2.43871 10.2563C2.49285 10.3897 2.51992 10.4563 2.532 10.5102C2.54381 10.5629 2.54813 10.6019 2.54814 10.6559C2.54814 10.7111 2.53812 10.7713 2.51807 10.8916L2.12275 13.2635C2.08135 13.5119 2.06065 13.6361 2.09917 13.7259C2.13289 13.8045 2.19552 13.8671 2.27412 13.9008C2.36393 13.9393 2.48812 13.9186 2.73651 13.8772L5.10843 13.4819C5.22872 13.4619 5.28887 13.4519 5.34409 13.4519C5.3981 13.4519 5.43711 13.4562 5.48981 13.468C5.54369 13.4801 5.61035 13.5072 5.74366 13.5613C6.4402 13.8442 7.2019 14 8 14ZM5.33333 8C5.33333 8.1841 5.1841 8.33333 5 8.33333C4.81591 8.33333 4.66667 8.1841 4.66667 8C4.66667 7.81591 4.81591 7.66667 5 7.66667C5.1841 7.66667 5.33333 7.81591 5.33333 8ZM8.33333 8C8.33333 8.1841 8.1841 8.33333 8 8.33333C7.81591 8.33333 7.66667 8.1841 7.66667 8C7.66667 7.81591 7.81591 7.66667 8 7.66667C8.1841 7.66667 8.33333 7.81591 8.33333 8ZM11.3333 8C11.3333 8.1841 11.1841 8.33333 11 8.33333C10.8159 8.33333 10.6667 8.1841 10.6667 8C10.6667 7.81591 10.8159 7.66667 11 7.66667C11.1841 7.66667 11.3333 7.81591 11.3333 8Z" stroke="#344054" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
)

export type IExploreSideBarProps = {
  controlUpdateInstalledApps: number
}

const SideBar: FC<IExploreSideBarProps> = ({
  controlUpdateInstalledApps,
}) => {
  const { t } = useTranslation()
  const segments = useSelectedLayoutSegments()
  const lastSegment = segments.slice(-1)[0]
  const isDiscoverySelected = lastSegment === 'apps'
  const isChatSelected = lastSegment === 'chat'
  const { installedApps, setInstalledApps } = useContext(ExploreContext)

  const media = useBreakpoints()
  const isMobile = media === MediaType.mobile

  const fetchInstalledAppList = async () => {
    const { installed_apps }: any = await doFetchInstalledAppList()
    setInstalledApps(installed_apps)
  }

  const [showConfirm, setShowConfirm] = useState(false)
  const [currId, setCurrId] = useState('')
  const handleDelete = async () => {
    const id = currId
    await uninstallApp(id)
    setShowConfirm(false)
    Toast.notify({
      type: 'success',
      message: t('common.api.remove'),
    })
    fetchInstalledAppList()
  }

  const handleUpdatePinStatus = async (id: string, isPinned: boolean) => {
    await updatePinStatus(id, isPinned)
    Toast.notify({
      type: 'success',
      message: t('common.api.success'),
    })
    fetchInstalledAppList()
  }

  useEffect(() => {
    fetchInstalledAppList()
  }, [])

  useEffect(() => {
    fetchInstalledAppList()
  }, [controlUpdateInstalledApps])

  const pinnedAppsCount = installedApps.filter(({ is_pinned }) => is_pinned).length
  return (
    <div className='w-fit sm:w-[216px] shrink-0 pt-6 px-4 border-gray-200 cursor-pointer'>
      <div>
        <Link
          href='/explore/apps'
          className={cn(isDiscoverySelected ? 'text-primary-600  bg-white font-semibold' : 'text-gray-700 font-medium hover:bg-gray-200', 'flex items-center pc:justify-start pc:w-full mobile:justify-center mobile:w-fit h-9 px-3 mobile:px-2 gap-2 rounded-lg')}
          style={isDiscoverySelected ? { boxShadow: '0px 1px 2px rgba(16, 24, 40, 0.05)' } : {}}
        >
          {isDiscoverySelected ? <SelectedDiscoveryIcon /> : <DiscoveryIcon />}
          {!isMobile && <div className='text-sm'>{t('explore.sidebar.discovery')}</div>}
        </Link>
      </div>
      {installedApps.length > 0 && (
        <div className='mt-10'>
          <p className='pl-2 mobile:px-0 text-xs text-gray-500 break-all font-medium uppercase'>{t('explore.sidebar.workspace')}</p>
          <div className='mt-3 space-y-1 overflow-y-auto overflow-x-hidden'
            style={{
              height: 'calc(100vh - 250px)',
            }}
          >
            {installedApps.map(({ id, is_pinned, uninstallable, app: { name, icon_type, icon, icon_url, icon_background } }, index) => (
              <React.Fragment key={id}>
                <Item
                  isMobile={isMobile}
                  name={name}
                  icon_type={icon_type}
                  icon={icon}
                  icon_background={icon_background}
                  icon_url={icon_url}
                  id={id}
                  isSelected={lastSegment?.toLowerCase() === id}
                  isPinned={is_pinned}
                  togglePin={() => handleUpdatePinStatus(id, !is_pinned)}
                  uninstallable={uninstallable}
                  onDelete={(id) => {
                    setCurrId(id)
                    setShowConfirm(true)
                  }}
                />
                {index === pinnedAppsCount - 1 && index !== installedApps.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      {showConfirm && (
        <Confirm
          title={t('explore.sidebar.delete.title')}
          content={t('explore.sidebar.delete.content')}
          isShow={showConfirm}
          onConfirm={handleDelete}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  )
}

export default React.memo(SideBar)
