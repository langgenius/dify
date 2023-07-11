import s from './index.module.css'
import type { GithubRepo } from '@/models/common'

const getStar = async () => {
  const res = await fetch('https://api.github.com/repos/langgenius/dify')

  if (!res.ok)
    throw new Error('Failed to fetch data')

  return res.json()
}

const GithubStar = async () => {
  const githubRepo: GithubRepo = await getStar()

  if (!githubRepo.stargazers_count)
    return null

  return (
    <a
      href='https://github.com/langgenius/dify'
      target='_blank'
      className='flex items-center leading-[18px] border border-gray-200 rounded-md text-xs text-gray-700 font-semibold overflow-hidden'>
      <div className='flex items-center px-2 py-1 bg-gray-100'>
        <div className={`${s['github-icon']} mr-1 rounded-full`} />
        Star
      </div>
      <div className='px-2 py-1 bg-white border-l border-gray-200'>{`${githubRepo.stargazers_count}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}</div>
    </a>
  )
}

export default GithubStar
