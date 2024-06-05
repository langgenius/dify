const translation = {
  welcome: {
    firstStepTip: '시작하려면,',
    enterKeyTip: '아래에 OpenAI API 키를 입력하세요',
    getKeyTip: 'OpenAI 대시보드에서 API 키를 가져오세요',
    placeholder: '나의 OpenAI API 키 (예: sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: '{{providerName}} 트라이얼 쿼터를 사용 중입니다.',
        description: '트라이얼 쿼터는 테스트용으로 제공됩니다. 트라이얼 쿼터 소진 전에 고유한 모델 제공자를 설정하거나 추가 쿼터를 구매하세요.',
      },
      exhausted: {
        title: '트라이얼 쿼터가 소진되었습니다. API 키를 설정하세요.',
        description: '트라이얼 쿼터가 소진되었습니다. 고유한 모델 제공자를 설정하거나 추가 쿼터를 구매하세요.',
      },
    },
    selfHost: {
      title: {
        row1: '시작하려면,',
        row2: '먼저 모델 제공자를 설정하세요.',
      },
    },
    callTimes: '요청 횟수',
    usedToken: '사용된 토큰',
    setAPIBtn: '모델 제공자 설정으로 이동',
    tryCloud: '또는 Dify의 클라우드 버전을 무료로 체험해보세요',
  },
  overview: {
    title: '개요',
    appInfo: {
      explanation: '사용하기 쉬운 AI 웹앱',
      accessibleAddress: '공개 URL',
      preview: '미리보기',
      regenerate: '재생성',
      regenerateNotice: '공개 URL을 재생성하시겠습니까?',
      preUseReminder: '계속하기 전에 웹앱을 활성화하세요.',
      settings: {
        entry: '설정',
        title: '웹앱 설정',
        webName: '웹앱 이름',
        webDesc: '웹앱 설명',
        webDescTip: '이 텍스트는 클라이언트 측에서 표시되며, 애플리케이션의 사용 방법에 대한 기본적인 안내를 제공합니다.',
        webDescPlaceholder: '웹앱 설명을 입력하세요',
        language: '언어',
        more: {
          entry: '추가 설정 보기',
          copyright: '저작권',
          copyRightPlaceholder: '저작권자 또는 조직 이름을 입력하세요',
          privacyPolicy: '개인정보 처리방침',
          privacyPolicyPlaceholder: '개인정보 처리방침 링크를 입력하세요',
          privacyPolicyTip: '방문자가 애플리케이션이 수집하는 데이터를 이해하고, Dify의 <privacyPolicyLink>개인정보 처리방침</privacyPolicyLink>을 참조할 수 있도록 합니다.',
        },
      },
      embedded: {
        entry: '임베드',
        title: '웹사이트에 임베드하기',
        explanation: '챗봇 앱을 웹사이트에 임베드하는 방법을 선택하세요.',
        iframe: '웹사이트의 원하는 위치에 챗봇 앱을 추가하려면 이 iframe을 HTML 코드에 추가하세요.',
        scripts: '웹사이트의 우측 하단에 챗봇 앱을 추가하려면 이 코드를 HTML에 추가하세요.',
        chromePlugin: 'Dify Chatbot Chrome 확장 프로그램 설치',
        copied: '복사되었습니다',
        copy: '복사',
      },
      qrcode: {
        title: '공유용 QR 코드',
        scan: '앱 공유를 스캔하세요',
        download: 'QR 코드 다운로드',
      },
      customize: {
        way: '방법',
        entry: '사용자화',
        title: 'AI 웹앱 사용자화',
        explanation: '시나리오와 스타일 요구에 따라 웹앱의 프론트엔드를 사용자화할 수 있습니다.',
        way1: {
          name: '클라이언트 코드를 포크하여 수정하고 Vercel에 배포하기 (권장)',
          step1: '클라이언트 코드를 포크하여 수정합니다',
          step1Tip: '여기를 클릭하여 소스 코드를 GitHub 계정에 포크하고 코드를 수정하세요',
          step1Operation: 'Dify-WebClient',
          step2: 'Vercel에 배포합니다',
          step2Tip: '여기를 클릭하여 리포지토리를 Vercel에 임포트하고 배포하세요',
          step2Operation: '리포지토리 임포트',
          step3: '환경 변수를 설정합니다',
          step3Tip: 'Vercel에 다음 환경 변수를 추가하세요',
        },
        way2: {
          name: '클라이언트 측 코드를 작성하여 API를 호출하고 서버에 배포합니다',
          operation: '문서',
        },
      },
    },
    apiInfo: {
      title: '백엔드 서비스 API',
      explanation: '개발자의 애플리케이션에 쉽게 통합할 수 있습니다',
      accessibleAddress: '서비스 API 엔드포인트',
      doc: 'API 레퍼런스',
    },
    status: {
      running: '서비스 중',
      disable: '비활성',
    },
  },
  analysis: {
    title: '분석',
    ms: 'ms',
    tokenPS: '토큰/초',
    totalMessages: {
      title: '총 메시지 수',
      explanation: '일일 AI 상호작용 수; 엔지니어링/디버깅 목적의 프롬프트는 제외됩니다.',
    },
    activeUsers: {
      title: '활성 사용자 수',
      explanation: 'AI와의 Q&A에 참여하는 고유 사용자 수; 엔지니어링/디버깅 목적의 프롬프트는 제외됩니다.',
    },
    tokenUsage: {
      title: '토큰 사용량',
      explanation: '애플리케이션의 언어 모델의 일일 토큰 사용량을 반영하여 비용 관리에 도움이 됩니다.',
      consumed: '소비된 토큰',
    },
    avgSessionInteractions: {
      title: '평균 세션 상호작용 수',
      explanation: '사용자와 AI의 연속적인 커뮤니케이션 수; 대화형 애플리케이션을 위한 것입니다.',
    },
    avgUserInteractions: {
      title: '평균 사용자 상호작용 수',
      explanation: '사용자의 일일 사용 빈도를 반영합니다. 이 지표는 사용자의 임계를 반영합니다.',
    },
    userSatisfactionRate: {
      title: '사용자 만족도율',
      explanation: '1,000개의 메시지 당 "좋아요" 수입니다. 이는 사용자가 매우 만족한 응답의 비율을 나타냅니다.',
    },
    avgResponseTime: {
      title: '평균 응답 시간',
      explanation: 'AI가 처리/응답하는 시간(밀리초); 텍스트 기반 애플리케이션을 위한 것입니다.',
    },
    tps: {
      title: '토큰 출력 속도',
      explanation: 'LLM의 성능을 측정합니다. 요청 시작부터 출력 완료까지의 LLM의 토큰 출력 속도를 계산합니다.',
    },
  },
}

export default translation
