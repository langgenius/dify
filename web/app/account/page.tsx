import AccountPage from './account-page'

export default function Account() {
  return <div className='max-w-[640px] w-full mx-auto pt-12 px-6'>
    <div className='pt-2 pb-3'>
      <h4 className='title-2xl-semi-bold text-primary'>My Account</h4>
    </div>
    <AccountPage />
  </div>
}
