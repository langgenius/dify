const translation = {
  toVerified: 'Get Education Verified',
  toVerifiedTip: {
    front: 'You are now eligible for Education Verified status. Please enter your education information below to complete the process and receive an',
    coupon: 'exclusive 100% coupon',
    end: 'for the Dify Professional Plan.',
  },
  currentSigned: 'CURRENTLY SIGNED IN AS',
  form: {
    schoolName: {
      title: 'Your School Name',
      placeholder: 'Enter the official, unabbreviated name of your school',
    },
    schoolRole: {
      title: 'Your School Role',
      option: {
        student: 'Student',
        teacher: 'Teacher',
        administrator: 'School Administrator',
      },
    },
    terms: {
      title: 'Terms & Agreements',
      desc: {
        front: 'Your information and use of Education Verified status are subject to our',
        and: 'and',
        end: '. By submitting:',
        termsOfService: 'Terms of Service',
        privacyPolicy: 'Privacy Policy',
      },
      option: {
        age: 'I confirm I am at least 18 years old',
        inSchool: 'I confirm I am enrolled or employed at the institution provided. Dify may request proof of enrollment/employment. If I misrepresent my eligibility, I agree to pay any fees initially waived based on my education status.',
      },
    },
  },
  submit: 'Submit',
  submitError: 'Form submission failed. Please try again later.',
  learn: 'Learn how to get education verified',
  successTitle: 'You Have Got Dify Education Verified',
  successContent: 'We have issued a 100% discount coupon for the Dify Professional plan to your account. The coupon is valid for one year, please use it within the validity period.',
  rejectTitle: 'Your Dify Educational Verification Has Been Rejected',
  rejectContent: 'Unfortunately, you are not eligible for Education Verified status and therefore cannot receive the exclusive 100% coupon for the Dify Professional Plan if you use this email address.',
  emailLabel: 'Your current email',
  notice: {
    dateFormat: 'MM/DD/YYYY',
    expired: {
      title: 'Your education status has expired',
      summary: {
        line1: 'You can still access and use Dify. ',
        line2: 'However, you\'re no longer eligible for new education discount coupons.',
      },
    },
    isAboutToExpire: {
      title: 'Your education status will expire on {{date}}',
      summary: 'Don\'t worry — this won\'t affect your current subscription, but you won\'t get the education discount when it renews unless you verify your status again.',
    },
    stillInEducation: {
      title: 'Still in education?',
      expired: 'Re-verify now to get a new coupon for the upcoming academic year. We\'ll add it to your account and you can use it for the next upgrade.',
      isAboutToExpire: 'Re-verify now to get a new coupon for the upcoming academic year. It\'ll be saved to your account and ready to use at your next renewal.',
    },
    alreadyGraduated: {
      title: 'Already graduated?',
      expired: 'Feel free to upgrade anytime to get full access to paid features.',
      isAboutToExpire: 'Your current subscription will still remain active. When it ends, you\'ll be moved to the Sandbox plan, or you can upgrade anytime to restore full access to paid features.',
    },
    action: {
      dismiss: 'Dismiss',
      upgrade: 'Upgrade',
      reVerify: 'Re-verify',
    },
  },
}

export default translation
