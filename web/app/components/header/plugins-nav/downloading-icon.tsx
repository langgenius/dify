import s from './downloading-icon.module.css'

const DownloadingIcon = () => {
  return (
    <div className="inline-flex text-components-button-secondary-text">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="install-icon">
        <g id="install-line">
          <path d="M8 2V4H5L4.999 14H18.999L19 4H16V2H20C20.5523 2 21 2.44772 21 3V21C21 21.5523 20.5523 22 20 22H4C3.44772 22 3 21.5523 3 21V3C3 2.44772 3.44772 2 4 2H8ZM18.999 16H4.999L5 20H19L18.999 16Z" fill="currentColor" />
          <path id={s.downloadingIconLight} d="M17 19V17H15V19H17Z" />
          <path id={s.downloadingIconArrow} d="M13 2V7H16L12 11L8 7H11V2H13Z" fill="currentColor" />
        </g>
      </svg>
    </div>
  )
}

export default DownloadingIcon
