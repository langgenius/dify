// import React from 'react'
// import AppList from '@/app/components/explore/app-list'

// const Apps = () => {
//   return <AppList />
// }

// export default React.memo(Apps)

//  TODO  , we don't needs tools for now

import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not Found",
  description: "This page does not exist",
  robots: {
    index: false,
    follow: false,
  },
  alternates: {
    canonical: "/explore/apps",
  },
};

export default function page() {
  return notFound();
}
