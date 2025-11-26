const translation = {
  subscription: {
    title: 'Підписки',
    listNum: '{{num}} підписки',
    empty: {
      title: 'Немає підписок',
      button: 'Нова підписка',
    },
    createButton: {
      oauth: 'Нова підписка з OAuth',
      apiKey: 'Нова підписка з ключем API',
      manual: 'Вставте URL, щоб створити нову підписку',
    },
    createSuccess: 'Підписку успішно створено',
    createFailed: 'Не вдалося створити підписку',
    maxCount: 'Макс {{num}} підписок',
    selectPlaceholder: 'Виберіть підписку',
    noSubscriptionSelected: 'Підписка не обрана',
    subscriptionRemoved: 'Підписку видалено',
    list: {
      title: 'Підписки',
      addButton: 'Додати',
      tip: 'Отримувати події через підписку',
      item: {
        enabled: 'Увімкнено',
        disabled: 'Вимкнено',
        credentialType: {
          api_key: 'API ключ',
          oauth2: 'OAuth',
          unauthorized: 'Посібник',
        },
        actions: {
          delete: 'Видалити',
          deleteConfirm: {
            title: 'Видалити {{name}}?',
            success: 'Підписку {{name}} успішно видалено',
            error: 'Не вдалося видалити підписку {{name}}',
            content: 'Після видалення цю підписку неможливо буде відновити. Будь ласка, підтвердіть.',
            contentWithApps: 'Поточна підписка використовується {{count}} додатками. Видалення підписки призведе до того, що налаштовані додатки перестануть отримувати події підписки.',
            confirm: 'Підтвердити видалення',
            cancel: 'Скасувати',
            confirmInputWarning: 'Будь ласка, введіть правильне ім’я для підтвердження.',
            confirmInputPlaceholder: 'Введіть "{{name}}", щоб підтвердити.',
            confirmInputTip: 'Будь ласка, введіть «{{name}}», щоб підтвердити.',
          },
        },
        status: {
          active: 'Активний',
          inactive: 'Неактивний',
        },
        usedByNum: 'Використовується в {{num}} робочих процесах',
        noUsed: 'Жодного робочого процесу не використано',
      },
    },
    addType: {
      title: 'Додати підписку',
      description: 'Виберіть, як ви хочете створити підписку на тригер',
      options: {
        apikey: {
          title: 'Створити за допомогою ключа API',
          description: 'Автоматично створювати підписку за допомогою облікових даних API',
        },
        oauth: {
          title: 'Створити з OAuth',
          description: 'Авторизуйтеся через сторонню платформу, щоб створити підписку',
          clientSettings: 'Налаштування клієнта OAuth',
          clientTitle: 'Клієнт OAuth',
          default: 'За замовчуванням',
          custom: 'Налаштований',
        },
        manual: {
          title: 'Ручне налаштування',
          description: 'Вставте URL, щоб створити нову підписку',
          tip: 'Налаштуйте URL на сторонній платформі вручну',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Перевірити',
      configuration: 'Налаштування',
    },
    common: {
      cancel: 'Скасувати',
      back: 'Назад',
      next: 'Далі',
      create: 'Створити',
      verify: 'Перевірити',
      authorize: 'Авторизувати',
      creating: 'Створення...',
      verifying: 'Перевірка...',
      authorizing: 'Авторизація...',
    },
    oauthRedirectInfo: 'Оскільки для цього постачальника інструментів не знайдено жодних системних секретів клієнта, необхідно налаштувати його вручну, для redirect_uri, будь ласка, використовуйте',
    apiKey: {
      title: 'Створити за допомогою ключа API',
      verify: {
        title: 'Перевірити облікові дані',
        description: 'Будь ласка, надайте свої облікові дані API для перевірки доступу',
        error: 'Перевірка облікових даних не вдалася. Будь ласка, перевірте свій API-ключ.',
        success: 'Облікові дані успішно перевірено',
      },
      configuration: {
        title: 'Налаштувати підписку',
        description: 'Налаштуйте параметри вашої підписки',
      },
    },
    oauth: {
      title: 'Створити з OAuth',
      authorization: {
        title: 'Авторизація OAuth',
        description: 'Дозвольте Dify отримати доступ до вашого акаунту',
        redirectUrl: 'URL перенаправлення',
        redirectUrlHelp: 'Використайте цей URL у налаштуваннях вашого OAuth-додатку',
        authorizeButton: 'Авторизуйтеся за допомогою {{provider}}',
        waitingAuth: 'Очікування авторизації...',
        authSuccess: 'Авторизація успішна',
        authFailed: 'Не вдалося отримати інформацію про авторизацію OAuth',
        waitingJump: 'Дозволено, очікування стрибка',
      },
      configuration: {
        title: 'Налаштувати підписку',
        description: 'Налаштуйте параметри підписки після авторизації',
        success: 'Конфігурація OAuth успішна',
        failed: 'Не вдалося налаштувати OAuth',
      },
      remove: {
        success: 'OAuth успішно видалено',
        failed: 'Не вдалося видалити OAuth',
      },
      save: {
        success: 'Конфігурацію OAuth успішно збережено',
      },
    },
    manual: {
      title: 'Ручне налаштування',
      description: 'Налаштуйте підписку на вебхук вручну',
      logs: {
        title: 'Журнали запитів',
        request: 'Запит',
        loading: 'Очікується запит від {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Назва підписки',
        placeholder: 'Введіть назву підписки',
        required: 'Потрібно вказати назву підписки',
      },
      callbackUrl: {
        label: 'URL зворотного виклику',
        description: 'Цей URL буде отримувати події вебхука',
        tooltip: 'Надайте загальнодоступну кінцеву точку, яка може приймати запити зворотного виклику від постачальника тригерів.',
        placeholder: 'Генерація...',
        privateAddressWarning: 'Цей URL, схоже, є внутрішньою адресою, що може спричинити помилки у запитах вебхука. Ви можете змінити TRIGGER_URL на публічну адресу.',
      },
    },
    errors: {
      createFailed: 'Не вдалося створити підписку',
      verifyFailed: 'Не вдалося перевірити облікові дані',
      authFailed: 'Авторизація не вдалася',
      networkError: 'Помилка мережі, будь ласка, спробуйте ще раз',
    },
  },
  events: {
    title: 'Доступні події',
    description: 'Події, на які цей плагін тригера може підписатися',
    empty: 'Події відсутні',
    event: 'Подія',
    events: 'Події',
    actionNum: '{{num}} {{event}} ВКЛЮЧЕНО',
    item: {
      parameters: '{{count}} параметри',
      noParameters: 'Немає параметрів',
    },
    output: 'Вихід',
  },
  node: {
    status: {
      warning: 'Відключити',
    },
  },
}

export default translation
