'use client'
import React, { useEffect, useState } from 'react'
import { Github } from '@/app/components/base/icons/src/public/common'
import type { GithubRepo } from '@/models/common'

const getStar = async () => {
  const res = await fetch('https://api.github.com/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch data')

  return res.json()
}

const GithubStar = () => {
  const [githubRepo, setGithubRepo] = useState<GithubRepo>({ stargazers_count: 6000 })
  const [isFetched, setIsFetched] = useState(false)
  useEffect(() => {
    (async () => {
      try {
        if (process.env.NODE_ENV === 'development')
          return

        await setGithubRepo(await getStar())
        setIsFetched(true)
      }
      catch (e) {

      }
    })()
  }, [])

  if (!isFetched)
    return null

  return (
    <a
      href='https://github.com/langgenius/dify'
      target='_blank' rel='noopener noreferrer'
      className='flex items-center leading-[18px] border border-gray-200 rounded-md text-xs text-gray-700 font-semibold overflow-hidden'>
    </a>
  )
}

export default GithubStar
