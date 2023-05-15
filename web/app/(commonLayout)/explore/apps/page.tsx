import React, { FC } from 'react'

export interface IAppsProps { }

const Apps: FC<IAppsProps> = ({ }) => {
  return (
    <div>
      apps
    </div>
  )
}
export default React.memo(Apps)
