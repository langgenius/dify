const translation = {
  toVerifiedTip: {
    end: 'Dify 프로페셔널 플랜 100% 할인 쿠폰을 받으세요.',
    coupon: '독점 100% 쿠폰',
    front:
      '교육 인증 상태를 받을 자격이 있습니다. 아래에 교육 정보를 입력하여 인증 과정을 완료하고',
  },
  form: {
    schoolName: {
      placeholder: '학교의 공식 약어가 아닌 전체 이름을 입력하세요.',
      title: '학교 이름',
    },
    schoolRole: {
      option: {
        teacher: '교사',
        student: '학생',
        administrator: '학교 관리자',
      },
      title: '학교 역할',
    },
    terms: {
      desc: {
        end: '제출함으로써:',
        and: '및',
        termsOfService: '서비스 약관',
        front: '귀하의 정보 및 교육 인증 상태 사용은 우리의',
        privacyPolicy: '개인정보 처리방침',
      },
      option: {
        inSchool:
          '나는 제공된 기관에 재학 중이거나 고용되어 있음을 확인합니다. Dify는 재학증명서나 고용증명서를 요청할 수 있습니다. 자격을 허위로 기재할 경우, 면제된 수수료를 지불하기로 동의합니다.',
        age: '만 18세 이상입니다.',
      },
      title: '약관 및 동의사항',
    },
  },
  submit: '제출',
  rejectContent:
    '안타깝게도 귀하는 교육 인증 자격에 부합하지 않으므로, 이 이메일 주소로는 Dify 프로페셔널 플랜 100% 할인 쿠폰을 받을 수 없습니다.',
  successContent:
    '귀하의 계정에 Dify 프로페셔널 플랜을 위한 100% 할인 쿠폰을 발급했습니다. 이 쿠폰은 1년간 유효하므로 유효 기간 내에 사용해 주시기 바랍니다.',
  currentSigned: '현재 로그인 중',
  toVerified: '교육 인증 받기',
  rejectTitle: 'Dify 교육 인증이 거부되었습니다.',
  learn: '교육 인증을 받는 방법 알아보기',
  submitError: '양식 제출에 실패했습니다. 나중에 다시 시도해 주세요.',
  successTitle: 'Dify 교육 인증을 받았습니다.',
  emailLabel: '현재 이메일',
  notice: {
    expired: {
      summary: {
        line1: '여전히 Dify에 접근하고 사용할 수 있습니다.',
        line2: '하지만, 더 이상 새로운 교육 할인 쿠폰을 받을 수 없습니다.',
      },
      title: '교육 인증 상태가 만료되었습니다.',
    },
    isAboutToExpire: {
      summary: '걱정하지 마세요. 현재 구독에는 영향을 주지 않지만, 다시 인증하지 않으면 갱신 시 교육 할인 혜택을 받을 수 없습니다.',
      title: '교육 인증 상태가 {{date}}에 만료됩니다',
    },
    stillInEducation: {
      title: '아직 학업 중이신가요?',
      isAboutToExpire: '새로운 학년을 위한 쿠폰을 받으려면 지금 다시 인증하세요. 쿠폰은 계정에 저장되어 다음 갱신 시 사용할 수 있습니다.',
      expired: '지금 다시 인증하여 다가오는 학년도에 사용할 새 쿠폰을 받으세요. 계정에 쿠폰이 추가되며, 다음 업그레이드 시 사용할 수 있습니다.',
    },
    alreadyGraduated: {
      title: '이미 졸업하셨나요?',
      expired: '유료 기능에 대한 전체 액세스를 유지하려면 언제든지 업그레이드하세요.',
      isAboutToExpire: '현재 구독은 여전히 유효합니다. 구독이 종료되면 샌드박스 요금제로 변경되며, 언제든지 업그레이드하여 유료 기능을 다시 사용할 수 있습니다.',
    },
    action: {
      dismiss: '닫기',
      upgrade: '업그레이드',
      reVerify: '재인증',
    },
    dateFormat: 'YYYY-MM-DD',
  },
}

export default translation