const translation = {
  toVerified: '教育認証を取得',
  toVerifiedTip: {
    front: '現在、教育認証ステータスを取得する資格があります。以下に教育情報を入力し、認証プロセスを完了すると、Dify プロフェッショナルプランの',
    coupon: '100％割引クーポン',
    end: 'を受け取ることができます。',
  },
  currentSigned: '現在ログイン中のアカウントは',
  form: {
    schoolName: {
      title: '学校名',
      placeholder: '学校の正式名称（省略不可）を入力してください。',
    },
    schoolRole: {
      title: '学校での役割',
      option: {
        student: '学生',
        teacher: '教師',
        administrator: '学校管理者',
      },
    },
    terms: {
      title: '利用規約と同意事項',
      desc: {
        front: 'お客様の情報および 教育認証ステータス の利用は、当社の ',
        and: 'および',
        end: 'に従うものとします。送信することで以下を確認します：',
        termsOfService: '利用規約',
        privacyPolicy: 'プライバシーポリシー',
      },
      option: {
        age: '18 歳以上であることを確認します。',
        inSchool: '提供した教育機関に在籍または勤務している ことを確認します。Dify は在籍/雇用証明の提出を求める場合があります。不正な情報を申告した場合、教育認証に基づき免除された費用を支払うことに同意します。',
      },
    },
  },
  submit: '送信',
  submitError: 'フォームの送信に失敗しました。しばらくしてから再度ご提出ください。',
  learn: '教育認証の取得方法はこちら',
  successTitle: 'Dify 教育認証を取得しました！',
  successContent: 'お客様のアカウントに Dify プロフェッショナルプランの 100% 割引クーポン を発行しました。有効期間は 1 年間 ですので、期限内にご利用ください。',
  rejectTitle: 'Dify 教育認証が拒否されました',
  rejectContent: '申し訳ございませんが、このメールアドレスでは 教育認証 の資格を取得できず、Dify プロフェッショナルプランの 100％割引クーポン を受け取ることはできません。',
  emailLabel: '現在のメールアドレス',
  notice: {
    dateFormat: 'YYYY/MM/DD',
    expired: {
      title: 'あなたの教育認証は失効しました',
      summary: {
        line1: 'Dify は引き続きご利用いただけますが、新しい教育割引クーポンの対象外となります。',
        line2: '',
      },
    },
    isAboutToExpire: {
      title: 'あなたの教育認証は {{date}} に有効期限を迎えます',
      summary: 'ご安心ください。現在のサブスクリプションには影響ありません。ただし、再認証を行わない場合、次回の更新時に教育割引を受けることができません。',
    },
    stillInEducation: {
      title: 'まだ在学中ですか？',
      expired: '今すぐ再認証して、次の学年度向けの教育クーポンを取得してください。クーポンはあなたのアカウントに追加され、次回のアップグレード時にご利用いただけます。',
      isAboutToExpire: '今すぐ再認証して、次の学年度向けの教育クーポンを取得してください。クーポンは個人のアカウントに保存され、次回の更新時に使用できます。',
    },
    alreadyGraduated: {
      title: 'すでに卒業しましたか？',
      expired: 'いつでもアップグレードして、すべての有料機能にアクセスすることができます。',
      isAboutToExpire: '今すぐ再認証して、次の学年度向けの教育クーポンを取得してください。クーポンはあなたのアカウントに追加され、次回のアップグレード時にご利用いただけます。',
    },
    action: {
      dismiss: '無視',
      upgrade: 'アップグレード',
      reVerify: '再認証する',
    },
  },
}

export default translation
