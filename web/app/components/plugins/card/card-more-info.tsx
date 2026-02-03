import { RiPriceTag3Line } from '@remixicon/react'
import * as React from 'react'

type Props = {
  tags: string[]
}

const CardMoreInfoComponent = ({
  tags,
}: Props) => {
  return (
    <div className="mt-2 flex min-h-[20px] items-center gap-1">
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap gap-1 overflow-hidden">
          {tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="inline-flex max-w-[100px] items-center gap-0.5 truncate rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-[5px] py-[3px]"
              title={tag}
            >
              <RiPriceTag3Line className="h-3 w-3 shrink-0 text-text-quaternary" />
              <span className="system-2xs-medium-uppercase text-text-tertiary">{tag.toUpperCase()}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Memoize to prevent unnecessary re-renders when tags array hasn't changed
const CardMoreInfo = React.memo(CardMoreInfoComponent)

export default CardMoreInfo
