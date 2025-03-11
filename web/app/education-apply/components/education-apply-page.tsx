import Image from 'next/image'
import UserInfo from './user-info'
import SearchInput from './search-input'
import Radio from '@/app/components/base/radio'
import Switch from '@/app/components/base/switch'

const EducationApplyAge = () => {
  return (
    <div className='p-6'>
      <div className='relative border border-effects-highlight bg-background-default-subtle rounded-2xl'>
        <Image
          src={'/logo/logo.png'}
          className='absolute top-0 h-auto'
          alt='education background image'
        />
        <div className='flex items-center justify-between px-8 py-6 h-[88px]'>
          <div></div>
          <div></div>
        </div>
        <div className='px-8 pt-20 w-[656px]'>
          <div className='mb-2 pt-3 pb-4 text-text-primary-on-surface'>
            <div className='mb-2 title-5xl-bold shadow-xs'>Get Education Verified </div>
            <div className='system-md-medium shadow-xs'>You are now eligible for Education Verified status. Please enter your education information below to complete the process and receive an exclusive 50% coupon for the Dify Professional Plan.</div>
          </div>
          <div className='mb-7'>
            <UserInfo />
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              Your School Name
            </div>
            <SearchInput />
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              Your School Role
            </div>
            <Radio.Group
              className='flex items-center'
            >
              <Radio value={1}>Student</Radio>
              <Radio value={2}>Teacher</Radio>
              <Radio value={3}>School Administrator</Radio>
            </Radio.Group>
          </div>
          <div className='mb-7'>
            <div className='flex items-center mb-1 h-6 system-md-semibold text-text-secondary'>
              Terms & Agreements
            </div>
            <div className='mb-1 system-md-regular text-text-tertiary'>
              Your information and use of education verified status are subject to our Terms of Service and Privacy Policy. By submitting:
            </div>
            <div className='py-2 system-md-regular text-text-primary'>
              <div className='flex mb-2'>
                <Switch className='mr-2' />
                I confirm I am at least 18 years old
              </div>
              <div className='flex'>
                <Switch className='mr-2' />
                I confirm I am enrolled or employed at the institution provided. Dify may request proof of enrollment/employment. If I misrepresent my eligibility, I agree to pay any fees initially waived based on my education status.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EducationApplyAge
