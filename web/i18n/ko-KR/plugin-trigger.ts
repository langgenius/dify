const translation = {
  subscription: {
    title: '구독',
    listNum: '{{num}} 구독',
    empty: {
      title: '구독 없음',
      button: '새 구독',
    },
    createButton: {
      oauth: 'OAuth로 새 구독',
      apiKey: 'API 키를 이용한 새 구독',
      manual: '새 구독을 만들려면 URL을 붙여넣으세요',
    },
    createSuccess: '구독이 성공적으로 생성되었습니다',
    createFailed: '구독 생성에 실패했습니다',
    maxCount: '최대 {{num}} 구독',
    selectPlaceholder: '구독 선택',
    noSubscriptionSelected: '선택한 구독이 없습니다',
    subscriptionRemoved: '구독 취소됨',
    list: {
      title: '구독',
      addButton: '추가',
      tip: '구독을 통해 이벤트 받기',
      item: {
        enabled: '활성화됨',
        disabled: '사용하지 않음',
        credentialType: {
          api_key: 'API 키',
          oauth2: 'OAuth',
          unauthorized: '매뉴얼',
        },
        actions: {
          delete: '삭제',
          deleteConfirm: {
            title: '{{name}}을(를) 삭제하시겠습니까?',
            success: '구독 {{name}}이(가) 성공적으로 삭제되었습니다',
            error: '구독 {{name}} 삭제 실패',
            content: '삭제하면 이 구독은 복구할 수 없습니다. 확인해주세요.',
            contentWithApps: '현재 구독은 {{count}}개의 애플리케이션에서 참조되고 있습니다. 이를 삭제하면 구성된 애플리케이션이 구독 이벤트를 받지 않게 됩니다.',
            confirm: '삭제 확인',
            cancel: '취소',
            confirmInputWarning: '확인을 위해 올바른 이름을 입력해 주세요.',
            confirmInputPlaceholder: '"{{name}}"를 입력하여 확인하세요.',
            confirmInputTip: '확인을 위해 “{{name}}”를 입력해 주세요.',
          },
        },
        status: {
          active: '활성',
          inactive: '비활성',
        },
        usedByNum: '{{num}} 워크플로우에서 사용됨',
        noUsed: '사용된 워크플로우 없음',
      },
    },
    addType: {
      title: '구독 추가',
      description: '트리거 구독을 생성하는 방법을 선택하세요',
      options: {
        apikey: {
          title: 'API 키로 생성',
          description: 'API 자격 증명을 사용하여 자동으로 구독 생성',
        },
        oauth: {
          title: 'OAuth로 생성',
          description: '구독을 생성하려면 타사 플랫폼으로 인증하세요',
          clientSettings: 'OAuth 클라이언트 설정',
          clientTitle: 'OAuth 클라이언트',
          default: '기본',
          custom: '사용자 지정',
        },
        manual: {
          title: '수동 설정',
          description: '새 구독을 만들려면 URL을 붙여넣으세요',
          tip: '타사 플랫폼에서 URL을 수동으로 구성',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: '확인',
      configuration: '설정',
    },
    common: {
      cancel: '취소',
      back: '뒤로',
      next: '다음',
      create: '만들다',
      verify: '확인',
      authorize: '권한 부여',
      creating: '생성 중...',
      verifying: '검증 중...',
      authorizing: '승인 중...',
    },
    oauthRedirectInfo: '이 도구 제공자에 대한 시스템 클라이언트 비밀이 발견되지 않아 수동 설정이 필요하며, redirect_uri에는 다음을 사용해 주세요',
    apiKey: {
      title: 'API 키로 생성',
      verify: {
        title: '자격 증명 확인',
        description: '액세스를 확인하려면 API 자격 증명을 제공해 주세요',
        error: '자격 증명 확인에 실패했습니다. API 키를 확인해주세요.',
        success: '자격 증명이 성공적으로 확인되었습니다',
      },
      configuration: {
        title: '구독 설정',
        description: '구독 설정을 구성하세요',
      },
    },
    oauth: {
      title: 'OAuth로 생성',
      authorization: {
        title: 'OAuth 인증',
        description: 'Dify가 귀하의 계정에 접근하도록 허용',
        redirectUrl: '리디렉션 URL',
        redirectUrlHelp: '이 URL을 OAuth 앱 구성에 사용하세요',
        authorizeButton: '{{provider}}로 승인',
        waitingAuth: '승인 대기 중...',
        authSuccess: '승인 성공',
        authFailed: 'OAuth 인증 정보를 가져오지 못했습니다',
        waitingJump: '승인됨, 이륙 대기 중',
      },
      configuration: {
        title: '구독 설정',
        description: '승인 후 구독 설정을 구성하세요',
        success: 'OAuth 구성 성공',
        failed: 'OAuth 구성 실패',
      },
      remove: {
        success: 'OAuth 제거 성공',
        failed: 'OAuth 제거 실패',
      },
      save: {
        success: 'OAuth 구성이 성공적으로 저장되었습니다',
      },
    },
    manual: {
      title: '수동 설정',
      description: '웹훅 구독을 수동으로 구성하세요',
      logs: {
        title: '요청 기록',
        request: '요청',
        loading: '{{pluginName}}의 요청을 기다리는 중...',
      },
    },
    form: {
      subscriptionName: {
        label: '구독 이름',
        placeholder: '구독 이름 입력',
        required: '구독 이름은 필수 항목입니다',
      },
      callbackUrl: {
        label: '콜백 URL',
        description: '이 URL은 웹훅 이벤트를 수신합니다',
        tooltip: '트리거 제공자로부터 콜백 요청을 받을 수 있는 공개 접근 가능한 엔드포인트를 제공하십시오.',
        placeholder: '생성 중...',
        privateAddressWarning: '이 URL은 내부 주소인 것으로 보이며, 이로 인해 웹후크 요청이 실패할 수 있습니다. TRIGGER_URL을 공개 주소로 변경할 수 있습니다.',
      },
    },
    errors: {
      createFailed: '구독 생성에 실패했습니다',
      verifyFailed: '인증 정보를 확인하지 못했습니다',
      authFailed: '인증 실패',
      networkError: '네트워크 오류가 발생했습니다. 다시 시도해주세요.',
    },
  },
  events: {
    title: '사용 가능한 이벤트',
    description: '이 트리거 플러그인이 구독할 수 있는 이벤트',
    empty: '이용 가능한 이벤트가 없습니다',
    event: '이벤트',
    events: '이벤트',
    actionNum: '{{num}} {{event}} 포함',
    item: {
      parameters: '{{count}} 매개변수',
      noParameters: '매개변수 없음',
    },
    output: '출력',
  },
  node: {
    status: {
      warning: '연결 끊기',
    },
  },
}

export default translation
