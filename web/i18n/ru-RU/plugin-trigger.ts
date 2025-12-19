const translation = {
  subscription: {
    title: 'Подписки',
    listNum: '{{num}} подписки',
    empty: {
      title: 'Нет подписок',
      button: 'Новая подписка',
    },
    createButton: {
      oauth: 'Новая подписка с OAuth',
      apiKey: 'Новая подписка с ключом API',
      manual: 'Вставьте URL для создания новой подписки',
    },
    createSuccess: 'Подписка успешно создана',
    createFailed: 'Не удалось создать подписку',
    maxCount: 'Макс {{num}} подписок',
    selectPlaceholder: 'Выберите подписку',
    noSubscriptionSelected: 'Подписка не выбрана',
    subscriptionRemoved: 'Подписка удалена',
    list: {
      title: 'Подписки',
      addButton: 'Добавить',
      tip: 'Получать события через подписку',
      item: {
        enabled: 'Включено',
        disabled: 'Отключено',
        credentialType: {
          api_key: 'API ключ',
          oauth2: 'OAuth',
          unauthorized: 'Руководство',
        },
        actions: {
          delete: 'Удалить',
          deleteConfirm: {
            title: 'Удалить {{name}}?',
            success: 'Подписка {{name}} успешно удалена',
            error: 'Не удалось удалить подписку {{name}}',
            content: 'После удаления эта подписка не может быть восстановлена. Пожалуйста, подтвердите.',
            contentWithApps: 'Текущая подписка используется {{count}} приложениями. Удаление подписки приведет к тому, что настроенные приложения перестанут получать события подписки.',
            confirm: 'Подтвердить удаление',
            cancel: 'Отмена',
            confirmInputWarning: 'Пожалуйста, введите правильное имя для подтверждения.',
            confirmInputPlaceholder: 'Введите "{{name}}", чтобы подтвердить.',
            confirmInputTip: 'Пожалуйста, введите «{{name}}», чтобы подтвердить.',
          },
        },
        status: {
          active: 'Активный',
          inactive: 'Неактивный',
        },
        usedByNum: 'Используется {{num}} рабочими процессами',
        noUsed: 'Рабочий процесс не используется',
      },
    },
    addType: {
      title: 'Добавить подписку',
      description: 'Выберите, как вы хотите создать подписку на триггер',
      options: {
        apikey: {
          title: 'Создать с помощью ключа API',
          description: 'Автоматически создавать подписку с использованием учетных данных API',
        },
        oauth: {
          title: 'Создать с помощью OAuth',
          description: 'Авторизуйтесь через стороннюю платформу, чтобы создать подписку',
          clientSettings: 'Настройки клиента OAuth',
          clientTitle: 'Клиент OAuth',
          default: 'По умолчанию',
          custom: 'Пользовательский',
        },
        manual: {
          title: 'Ручная настройка',
          description: 'Вставьте URL для создания новой подписки',
          tip: 'Настроить URL на сторонней платформе вручную',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'Проверить',
      configuration: 'Конфигурация',
    },
    common: {
      cancel: 'Отмена',
      back: 'Назад',
      next: 'Далее',
      create: 'Создать',
      verify: 'Проверить',
      authorize: 'Авторизовать',
      creating: 'Создание...',
      verifying: 'Проверка...',
      authorizing: 'Авторизация...',
    },
    oauthRedirectInfo: 'Так как для этого поставщика инструментов не найдены клиентские секреты системы, необходимо настроить его вручную, для redirect_uri используйте',
    apiKey: {
      title: 'Создать с помощью ключа API',
      verify: {
        title: 'Проверить учетные данные',
        description: 'Пожалуйста, предоставьте свои учетные данные API для проверки доступа',
        error: 'Проверка учетных данных не удалась. Пожалуйста, проверьте ваш API-ключ.',
        success: 'Учётные данные успешно проверены',
      },
      configuration: {
        title: 'Настроить подписку',
        description: 'Настройте параметры подписки',
      },
    },
    oauth: {
      title: 'Создать с помощью OAuth',
      authorization: {
        title: 'Авторизация OAuth',
        description: 'Разрешить Dify доступ к вашему аккаунту',
        redirectUrl: 'URL перенаправления',
        redirectUrlHelp: 'Используйте этот URL в настройках вашего приложения OAuth',
        authorizeButton: 'Авторизоваться с {{provider}}',
        waitingAuth: 'Ожидание авторизации...',
        authSuccess: 'Авторизация прошла успешно',
        authFailed: 'Не удалось получить информацию об авторизации OAuth',
        waitingJump: 'Авторизовано, ожидаем прыжка',
      },
      configuration: {
        title: 'Настроить подписку',
        description: 'Настройте параметры подписки после авторизации',
        success: 'Настройка OAuth выполнена успешно',
        failed: 'Сбой настройки OAuth',
      },
      remove: {
        success: 'OAuth успешно удалён',
        failed: 'Сбой при удалении OAuth',
      },
      save: {
        success: 'Настройка OAuth успешно сохранена',
      },
    },
    manual: {
      title: 'Ручная настройка',
      description: 'Настройте подписку на вебхук вручную',
      logs: {
        title: 'Журналы запросов',
        request: 'Запрос',
        loading: 'Ожидание запроса от {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'Название подписки',
        placeholder: 'Введите название подписки',
        required: 'Требуется название подписки',
      },
      callbackUrl: {
        label: 'URL для обратного вызова',
        description: 'Этот URL будет получать события вебхука',
        tooltip: 'Предоставьте общедоступную точку доступа, которая может принимать обратные вызовы от поставщика триггеров.',
        placeholder: 'Генерация...',
        privateAddressWarning: 'Похоже, что этот URL является внутренним адресом, из-за чего запросы вебхука могут не выполняться. Вы можете изменить TRIGGER_URL на публичный адрес.',
      },
    },
    errors: {
      createFailed: 'Не удалось создать подписку',
      verifyFailed: 'Не удалось проверить учетные данные',
      authFailed: 'Авторизация не удалась',
      networkError: 'Ошибка сети, пожалуйста, попробуйте ещё раз',
    },
  },
  events: {
    title: 'Доступные события',
    description: 'События, на которые может подписываться этот плагин триггера',
    empty: 'События отсутствуют',
    event: 'Событие',
    events: 'События',
    actionNum: '{{num}} {{event}} ВКЛЮЧЕНО',
    item: {
      parameters: 'параметры {{count}}',
      noParameters: 'Нет параметров',
    },
    output: 'Вывод',
  },
  node: {
    status: {
      warning: 'Отключить',
    },
  },
}

export default translation
