import * as React from 'react'

const Dot = () => {
  return <div className="system-xs-medium text-text-quaternary">·</div>
}

Dot.displayName = 'Dot'

export default React.memo(Dot)
