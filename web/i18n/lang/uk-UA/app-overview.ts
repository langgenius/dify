const translation = {
  welcome: {
    firstStepTip: 'Щоб розпочати,',
    enterKeyTip: 'введіть свій ключ API OpenAI нижче',
    getKeyTip: 'Отримайте свій ключ API з панелі керування OpenAI',
    placeholder: 'Ваш ключ API OpenAI (наприклад, sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'Ви використовуєте пробну квоту {{providerName}}.', // You are using...
        description: 'Пробна квота надається для використання під час тестування. Перш ніж вичерпається пробна квота, будь ласка, налаштуйте свого постачальника моделі або придбайте додаткову квоту.',
      },
      exhausted: {
        title: 'Ваша пробна квота використана, будь ласка, налаштуйте свій APIKey.',
        description: 'Ваша пробна квота вичерпана. Будь ласка, налаштуйте свого постачальника моделі або придбайте додаткову квоту.',
      },
    },
    selfHost: {
      title: {
        row1: 'Щоб розпочати,',
        row2: 'спочатку налаштуйте свого постачальника моделі.',
      },
    },
    callTimes: 'Кількість викликів', // Call times
    usedToken: 'Використано токенів', // Used token
    setAPIBtn: 'Перейти до налаштування постачальника моделі', // Go to setup model provider
    tryCloud: 'Або спробуйте хмарну версію Dify з безкоштовною квотою', // Or try the cloud version ...
  },
  overview: {
    title: 'Огляд', // Overview
    appInfo: {
      explanation: 'Готовий до використання AI WebApp',
      accessibleAddress: 'Публічна URL-адреса', // Public URL
      preview: 'Попередній перегляд', // Preview
      regenerate: 'Регенерувати', // Regenerate
      preUseReminder: 'Будь ласка, увімкніть WebApp, перш ніж продовжувати.', // Please enable WebApp...
      settings: {
        entry: 'Налаштування', // Settings
        title: 'Налаштування веб-програми', // WebApp Settings
        webName: 'Ім’я веб-програми', // WebApp Name
        webDesc: 'Опис веб-програми', // WebApp Description
        webDescTip: 'Цей текст відображатиметься на стороні клієнта, надаючи базові вказівки щодо використання програми',
        webDescPlaceholder: 'Введіть опис WebApp',
        language: 'Мова', // Language
        more: {
          entry: 'Показати більше налаштувань', // Show more settings
          copyright: 'Авторські права', // Copyright
          copyRightPlaceholder: 'Введіть ім’я автора або організації',
          privacyPolicy: 'Політика конфіденційності', // Privacy Policy
          privacyPolicyPlaceholder: 'Введіть посилання на політику конфіденційності',
          privacyPolicyTip: 'Допомагає відвідувачам зрозуміти, які дані збирає програма. Дивіться <privacyPolicyLink>Політику конфіденційності</privacyPolicyLink> Dify.',
        },
      },
      embedded: {
        entry: 'Вбудований', // Embedded
        title: 'Вбудувати на веб-сайт', // Embed on website
        explanation: 'Виберіть спосіб вбудувати чат-програму на свій веб-сайт',
        iframe: 'Щоб додати чат-програму будь-де на своєму веб-сайті, додайте цей iframe у свій код html.',
        scripts: 'Щоб додати програму чату у правий нижній кут свого веб-сайту, додайте цей код до свого html.',
        chromePlugin: 'Встановити розширення Dify Chatbot для Chrome',
        copied: 'Скопійовано', // Copied
        copy: 'Копіювати', // Copy
      },
      qrcode: {
        title: 'QR-код для спільного доступу',
        scan: 'Відсканувати програму спільного доступу',
        download: 'Завантажити QR-код',
      },
      customize: {
        way: 'спосіб', // way
        entry: 'Налаштувати', // Customize
        title: 'Налаштувати веб-додаток AI',
        explanation: 'Ви можете налаштувати зовнішній вигляд WebApp відповідно до вашого сценарію та стилю.',
        way1: {
          name: 'Розгалужити код клієнта, змінити його та розгорнути у Vercel (рекомендовано)',
          step1: 'Розгалужити код клієнта та модифікувати його',
          step1Tip: 'Натисніть тут, щоб розгалужити вихідний код у свій обліковий запис GitHub і змінити код',
          step1Operation: 'Dify-WebClient',
          step2: 'Розгорнути у Vercel',
          step2Tip: 'Натисніть тут, щоб імпортувати репозиторій до Vercel та виконати розгортання',
          step2Operation: 'Імпортувати репозиторій',
          step3: 'Налаштувати змінні середовища',
          step3Tip: 'Додайте такі змінні середовища у Vercel',
        },
        way2: {
          name: 'Напишіть код на клієнтській стороні, щоб викликати API та розгорнути його на сервері',
          operation: 'Документація',
        },
      },
    },
    apiInfo: {
      title: 'API бекенд-сервісу', // Backend service API
      explanation: 'Легко інтегрується в вашу програму',
      accessibleAddress: 'Кінцевий ресурс сервісу API', // Service API Endpoint
      doc: 'API довідка', // API Reference
    },
    status: {
      running: 'Працює', // In service
      disable: 'Вимкнути', // Disable
    },
  },
  analysis: {
    title: 'Аналіз', // Analysis
    ms: 'мс', // ms
    tokenPS: 'Токен/с', // Token/s
    totalMessages: {
      title: 'Загалом повідомлень', // Total Messages
      explanation: 'Щоденна кількість взаємодій зі ШІ; виключено проектування запитань або налагодження.',
    },
    activeUsers: {
      title: 'Активні користувачі', // Active Users
      explanation: 'Унікальні користувачі, які беруть участь у запитах/відповідях зі ШІ; виключено інженерію запитань або налагодження.',
    },
    tokenUsage: {
      title: 'Використання токенів', // Token Usage
      explanation: 'Відображає щоденне використання токенів мовної моделі для програми, корисно для контролю витрат.',
      consumed: 'Спожито', // Consumed
    },
    avgSessionInteractions: {
      title: 'Середня кількість взаємодій під час сеансу', // Avg. Session Interactions
      explanation: 'Кількість безперервних комунікацій між користувачем і ШІ; для програм, що базуються на розмовах.',
    },
    userSatisfactionRate: {
      title: 'Рівень задоволеності користувачів',
      explanation: 'Кількість лайків на 1000 повідомлень. Це означає частку відповідей, якими користувачі дуже задоволені.',
    },
    avgResponseTime: {
      title: 'Середній час відповіді',
      explanation: 'Час (мс) для обробки/відповіді ШІ; для текстових програм.',
    },
    tps: {
      title: 'Швидкість виведення токенів',
      explanation: 'Виміряйте продуктивність LLM. Підрахуйте швидкість виведення токенів LLM від початку запиту до завершення виведення.',
    },
  },
}

export default translation
