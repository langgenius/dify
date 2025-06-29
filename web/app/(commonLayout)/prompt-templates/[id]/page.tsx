'use client'
import React from 'react'
import Container from './Container'

const Page = ({ params }: { params: { id: string } }) => {
  return (
    <Container id={params.id} />
  )
}

export default Page
