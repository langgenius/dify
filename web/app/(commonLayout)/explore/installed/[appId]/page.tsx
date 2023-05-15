import React, { FC } from 'react'

export interface IInstalledAppProps { }

const InstalledApp: FC<IInstalledAppProps> = ({ }) => {
  return (
    <div>
      InstalledApp
    </div>
  )
}
export default React.memo(InstalledApp)
