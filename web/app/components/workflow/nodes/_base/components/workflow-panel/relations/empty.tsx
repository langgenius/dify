import { memo } from 'react'

type EmptyProps = {
  display: string
}

const Empty = ({
  display = '',
}: EmptyProps) => {
  return (
    <>
      <div
        className={`
          bg-dropzone-bg hover:bg-dropzone-bg-hover relative flex h-9 cursor-default items-center rounded-lg border border-dashed
          border-divider-regular !bg-components-dropzone-bg-alt px-2 text-xs
          text-text-placeholder
        `}
      >
        <div className='flex items-center uppercase'>
          {display}
        </div>
      </div>
    </>
  )
}

export default memo(Empty)
