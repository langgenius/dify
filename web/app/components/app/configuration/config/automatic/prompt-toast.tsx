import { RiCloseLine, RiInformation2Fill } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import React from 'react'
import cn from '@/utils/classnames'
import { Markdown } from '@/app/components/base/markdown'
type Props = {
  message: string
  className?: string
}
const PromptToast = ({
  message,
  className,
}: Props) => {
  const [isHide, {
    setTrue: hide,
  }] = useBoolean(false)
  //   const message = `
  // # h1
  // **strong text**  ~~strikethrough~~

  // * list1
  // * list2

  // xxxx

  // ## h2
  // \`\`\`python
  // print('Hello, World!')
  // \`\`\`
  //   `
  if (isHide)
    return
  return (
    <div className={cn('relative flex items-center p-2 ', className)}>
      {/* Background Effect */}
      <div className="pointer-events-none absolute inset-0 rounded-lg bg-[linear-gradient(92deg,rgba(11,165,236,0.25)_0%,rgba(255,255,255,0.00)_100%)] opacity-40 shadow-md"></div>
      <div className='relative flex h-full w-full  justify-between'>
        <div className="flex h-full w-0 grow gap-1">
          <RiInformation2Fill className="mt-[3px] size-4 shrink-0 text-text-accent" />
          <Markdown className="w-0 grow text-sm" content={message} />
        </div>

        <div className='relative  top-[-1px] shrink-0 cursor-pointer p-0.5' onClick={hide}>
          <RiCloseLine className='size-5 text-text-tertiary' />
        </div>
      </div>
    </div>
  )
}

export default PromptToast
