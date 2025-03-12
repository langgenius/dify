'use client'

import UserInfo from './user-info'
import SearchInput from './search-input'
import Radio from '@/app/components/base/radio'
import Button from '@/app/components/base/button'
import Checkbox from '@/app/components/base/checkbox'

const EducationApplyAge = () => {
  return (
    <div className='flex justify-center p-6 w-full h-full'>
      <div className='relative max-w-[1408px] w-full border border-effects-highlight bg-background-default-subtle rounded-2xl'>
        <div className='absolute top-0 w-full h-[349px] rounded-t-2xl overflow-hidden'>
          <img
            src={'/education/bg.png'}
            className='absolute top-0 left-1/2 translate-x-[-50%] w-[1464px] h-[480px]'
            alt='education background image'
          />
        </div>
        <div className='relative flex items-center justify-between px-8 py-6 h-[88px] z-10'>
          <div></div>
          <div></div>
        </div>
        <div className='relative m-auto px-8 pt-20 max-w-[720px] z-10'>
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
                <Checkbox className='shrink-0 mr-2' />
                I confirm I am at least 18 years old
              </div>
              <div className='flex'>
                <Checkbox className='shrink-0 mr-2' />
                I confirm I am enrolled or employed at the institution provided. Dify may request proof of enrollment/employment. If I misrepresent my eligibility, I agree to pay any fees initially waived based on my education status.
              </div>
            </div>
          </div>
          <Button
            variant='primary'
            disabled={false}
          >
            Send request
          </Button>
        </div>
      </div>
    </div>
  )
}

export default EducationApplyAge
