import React from 'react'

import './style.css'
type ILoadingProps = {
  type?: 'area' | 'app'
}
const Loading = (
  { type = 'area' }: ILoadingProps = { type: 'area' },
) => {
  return (
    <div className={`flex w-full items-center justify-center ${type === 'app' ? 'h-full' : ''}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className='spin-animation'>
        <g clipPath="url(#clip0_324_2488)">
          <path d="M15 0H10C9.44772 0 9 0.447715 9 1V6C9 6.55228 9.44772 7 10 7H15C15.5523 7 16 6.55228 16 6V1C16 0.447715 15.5523 0 15 0Z" fill="#1C64F2" />
          <path opacity="0.5" d="M15 9H10C9.44772 9 9 9.44772 9 10V15C9 15.5523 9.44772 16 10 16H15C15.5523 16 16 15.5523 16 15V10C16 9.44772 15.5523 9 15 9Z" fill="#1C64F2" />
          <path opacity="0.1" d="M6 9H1C0.447715 9 0 9.44772 0 10V15C0 15.5523 0.447715 16 1 16H6C6.55228 16 7 15.5523 7 15V10C7 9.44772 6.55228 9 6 9Z" fill="#1C64F2" />
          <path opacity="0.2" d="M6 0H1C0.447715 0 0 0.447715 0 1V6C0 6.55228 0.447715 7 1 7H6C6.55228 7 7 6.55228 7 6V1C7 0.447715 6.55228 0 6 0Z" fill="#1C64F2" />
        </g>
        <defs>
          <clipPath id="clip0_324_2488">
            <rect width="16" height="16" fill="white" />
          </clipPath>
        </defs>
      </svg>

    </div>
  )
}
export default Loading
