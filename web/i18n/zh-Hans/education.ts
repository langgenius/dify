const translation = {
  toVerified: '获取教育版认证',
  toVerifiedTip: {
    front: '您现在符合教育版认证的资格。请在下方输入您的教育信息，以完成认证流程，并领取 Dify  Professional 版的',
    coupon: '100% 独家优惠券',
    end: '。',
  },
  currentSigned: '您当前登录的账户是',
  form: {
    schoolName: {
      title: '您的学校名称',
      placeholder: '请输入您的学校的官方全称（不得缩写）',
    },
    schoolRole: {
      title: '您在学校的身份',
      option: {
        student: '学生',
        teacher: '教师',
        administrator: '学校管理员',
      },
    },
    terms: {
      title: '条款与协议',
      desc: {
        front: '您的信息和教育版认证资格的使用需遵守我们的',
        and: '和',
        end: '。提交即表示：',
        termsOfService: '服务条款',
        privacyPolicy: '隐私政策',
      },
      option: {
        age: '我确认我已年满 18 周岁。',
        inSchool: '我确认我目前已在提供的学校入学或受雇。Dify 可能会要求提供入学/雇佣证明。如我虚报资格，我同意支付因教育版认证而被减免的费用。',
      },
    },
  },
  submit: '提交',
  submitError: '提交表单失败，请稍后重新提交问卷。',
  learn: '了解如何获取教育版认证',
  successTitle: '您已成功获得 Dify 教育版认证！',
  successContent: '我们已向您的账户发放 Dify Professional 版 100% 折扣优惠券。该优惠券有效期为一年，请在有效期内使用。',
  rejectTitle: '您的 Dify 教育版认证已被拒绝',
  rejectContent: '非常遗憾，您无法使用此电子邮件以获得教育版认证资格，也无法领取 Dify Professional 版的 100% 独家优惠券。',
  emailLabel: '您当前的邮箱',
  notice: {
    dateFormat: 'YYYY/MM/DD',
    expired: {
      title: '您的教育认证已过期',
      summary: {
        line1: '您仍可继续使用 Dify，但将无法再领取新的教育优惠券。',
        line2: '',
      },
    },
    isAboutToExpire: {
      title: '您的教育认证将于 {{date}} 过期',
      summary: '别担心，这不会影响您当前的订阅。但续订时您将无法继续享受教育优惠，除非重新完成身份验证。',
    },
    stillInEducation: {
      title: '仍在就读？',
      expired: '立即重新认证，获取新学年的教育优惠券。优惠券将发放至您的账户，并可在下次升级时使用。',
      isAboutToExpire: '立即重新验证，获取新学年的教育优惠券。优惠券将发放至您的账户，并可在下次续订时使用。',
    },
    alreadyGraduated: {
      title: '已毕业？',
      expired: '您可以随时升级以获得所有付费功能。',
      isAboutToExpire: '您的当前订阅仍将保持有效。订阅结束后，空间将切换为 Sandbox 套餐，您也可以随时升级，恢复全部付费功能的使用。',
    },
    action: {
      dismiss: '忽略',
      upgrade: '升级套餐',
      reVerify: '重新认证',
    },
  },
}

export default translation
