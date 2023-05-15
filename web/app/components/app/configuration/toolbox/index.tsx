'use client'
import React, { FC } from 'react'
import GroupName from '../base/group-name'

export interface IToolboxProps {
  searchToolConfig: any
  sensitiveWordAvoidanceConifg: any
}

/*
* Include 
* 1. Search Tool
* 2. Sensitive word avoidance
*/
const Toolbox: FC<IToolboxProps> = ({ searchToolConfig, sensitiveWordAvoidanceConifg }) => {
  return (
    <div>
      <GroupName name='Toolbox' />
      <div>
        {searchToolConfig?.enabled && <div>Search Tool</div>}
        {sensitiveWordAvoidanceConifg?.enabled && <div>Sensitive word avoidance</div>}
      </div>
    </div>
  )
}
export default React.memo(Toolbox)
