import React from "react";
import type { FC } from 'react'
import LayoutClient, { ICommonLayoutProps } from "./_layout-client";
import GA, { GaType } from '@/app/components/base/ga'

const Layout: FC<ICommonLayoutProps> = ({ children }) => {
  return (
    <>
      <GA gaType={GaType.admin} />
      <LayoutClient children={children}></LayoutClient>
    </>
  )
}

export const metadata = {
  title: 'Dify',
}

export default Layout