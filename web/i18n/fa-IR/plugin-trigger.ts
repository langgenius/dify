const translation = {
  subscription: {
    title: 'اشتراک‌ها',
    listNum: 'اشتراک‌های {{num}}',
    empty: {
      title: 'بدون اشتراک',
      button: 'اشتراک جدید',
    },
    createButton: {
      oauth: 'اشتراک جدید با OAuth',
      apiKey: 'اشتراک جدید با کلید API',
      manual: 'چسباندن URL برای ایجاد اشتراک جدید',
    },
    createSuccess: 'اشتراک با موفقیت ایجاد شد',
    createFailed: 'ایجاد اشتراک با شکست مواجه شد',
    maxCount: 'حداکثر {{num}} اشتراک',
    selectPlaceholder: 'انتخاب اشتراک',
    noSubscriptionSelected: 'هیچ اشتراکی انتخاب نشده است',
    subscriptionRemoved: 'اشتراک حذف شد',
    list: {
      title: 'اشتراک‌ها',
      addButton: 'افزودن',
      tip: 'دریافت رویدادها از طریق اشتراک',
      item: {
        enabled: 'فعال',
        disabled: 'غیرفعال',
        credentialType: {
          api_key: 'کلید API',
          oauth2: 'اواف',
          unauthorized: 'دستی',
        },
        actions: {
          delete: 'حذف',
          deleteConfirm: {
            title: 'آیا {{name}} را حذف می‌کنید؟',
            success: 'اشتراک {{name}} با موفقیت حذف شد',
            error: 'حذف اشتراک {{name}} ناموفق بود',
            content: 'پس از حذف، این اشتراک قابل بازیابی نخواهد بود. لطفاً تأیید کنید.',
            contentWithApps: 'اشتراک فعلی توسط {{count}} برنامه مورد استفاده قرار گرفته است. حذف آن باعث می‌شود برنامه‌های پیکربندی‌شده دریافت رویدادهای اشتراک را متوقف کنند.',
            confirm: 'تأیید حذف',
            cancel: 'لغو',
            confirmInputWarning: 'لطفاً نام صحیح را برای تأیید وارد کنید.',
            confirmInputPlaceholder: 'برای تأیید «{{name}}» را وارد کنید.',
            confirmInputTip: 'لطفاً برای تأیید «{{name}}» را وارد کنید.',
          },
        },
        status: {
          active: 'فعال',
          inactive: 'غیرفعال',
        },
        usedByNum: 'استفاده شده توسط {{num}} جریان‌های کاری',
        noUsed: 'هیچ روند کاری استفاده نشده است',
      },
    },
    addType: {
      title: 'افزودن اشتراک',
      description: 'انتخاب کنید که چگونه می‌خواهید اشتراک محرک خود را ایجاد کنید',
      options: {
        apikey: {
          title: 'ایجاد با کلید API',
          description: 'ایجاد اشتراک به‌صورت خودکار با استفاده از اطلاعات ورود API',
        },
        oauth: {
          title: 'ایجاد با OAuth',
          description: 'با پلتفرم شخص ثالث مجوز بدهید تا اشتراک ایجاد شود',
          clientSettings: 'تنظیمات کلاینت OAuth',
          clientTitle: 'کلاینت OAuth',
          default: 'پیش‌فرض',
          custom: 'سفارشی',
        },
        manual: {
          title: 'راه‌اندازی دستی',
          description: 'چسباندن URL برای ایجاد اشتراک جدید',
          tip: 'تنظیم دستی URL در پلتفرم شخص ثالث',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'تأیید کردن',
      configuration: 'پیکربندی',
    },
    common: {
      cancel: 'لغو',
      back: 'بازگشت',
      next: 'بعدی',
      create: 'ایجاد کردن',
      verify: 'تأیید کردن',
      authorize: 'مجاز کردن',
      creating: 'در حال ایجاد...',
      verifying: 'در حال تأیید...',
      authorizing: 'در حال مجازسازی...',
    },
    oauthRedirectInfo: 'چون هیچ راز کلاینت سیستمی برای این ارائه‌دهنده ابزار پیدا نشد، تنظیم آن به صورت دستی لازم است، برای redirect_uri لطفاً استفاده کنید',
    apiKey: {
      title: 'ایجاد با کلید API',
      verify: {
        title: 'تأیید اطلاعات کاربری',
        description: 'لطفاً اطلاعات API خود را برای تأیید دسترسی ارائه دهید',
        error: 'تأیید اعتبار ناموفق بود. لطفاً کلید API خود را بررسی کنید.',
        success: 'اعتبارات با موفقیت تأیید شد',
      },
      configuration: {
        title: 'پیکربندی اشتراک',
        description: 'پارامترهای اشتراک خود را تنظیم کنید',
      },
    },
    oauth: {
      title: 'ایجاد با OAuth',
      authorization: {
        title: 'مجوز او‌آه‌اِس',
        description: 'اجازه دهید دیفی به حساب شما دسترسی داشته باشد',
        redirectUrl: 'تغییر مسیر آدرس اینترنتی',
        redirectUrlHelp: 'از این URL در تنظیمات برنامه OAuth خود استفاده کنید',
        authorizeButton: 'مجوزدهی با {{provider}}',
        waitingAuth: 'در انتظار مجوز...',
        authSuccess: 'مجوز با موفقیت صادر شد',
        authFailed: 'دریافت اطلاعات مجوز OAuth ناکام ماند',
        waitingJump: 'مجاز، در انتظار پرش',
      },
      configuration: {
        title: 'پیکربندی اشتراک',
        description: 'پس از تأیید هویت، پارامترهای اشتراک خود را تنظیم کنید',
        success: 'پیکربندی OAuth با موفقیت انجام شد',
        failed: 'پیکربندی OAuth با شکست مواجه شد',
      },
      remove: {
        success: 'حذف OAuth با موفقیت انجام شد',
        failed: 'حذف OAuth ناموفق بود',
      },
      save: {
        success: 'پیکربندی OAuth با موفقیت ذخیره شد',
      },
    },
    manual: {
      title: 'راه‌اندازی دستی',
      description: 'اشتراک وب‌هوک خود را به‌صورت دستی تنظیم کنید',
      logs: {
        title: 'گزارش‌های درخواست',
        request: 'درخواست',
        loading: 'در انتظار درخواست از {{pluginName}}...',
      },
    },
    form: {
      subscriptionName: {
        label: 'نام اشتراک',
        placeholder: 'نام اشتراک را وارد کنید',
        required: 'نام اشتراک الزامی است',
      },
      callbackUrl: {
        label: 'آدرس بازگشت تماس',
        description: 'این آدرس URL رویدادهای وب هوک را دریافت خواهد کرد',
        tooltip: 'یک نقطه دسترسی عمومی فراهم کنید که بتواند درخواست‌های بازگشتی از ارائه‌دهنده تریگر را دریافت کند.',
        placeholder: 'در حال تولید...',
        privateAddressWarning: 'به نظر می‌رسد این URL یک آدرس داخلی است که ممکن است باعث شود درخواست‌های وب‌هوک با شکست مواجه شوند. شما می‌توانید TRIGGER_URL را به یک آدرس عمومی تغییر دهید.',
      },
    },
    errors: {
      createFailed: 'ایجاد اشتراک با شکست مواجه شد',
      verifyFailed: 'تأیید اطلاعات ورود ناموفق بود',
      authFailed: 'مجوز ناموفق بود',
      networkError: 'خطای شبکه، لطفاً دوباره تلاش کنید',
    },
  },
  events: {
    title: 'رویدادهای موجود',
    description: 'رویدادهایی که این افزونه فعال‌سازی می‌تواند به آن‌ها مشترک شود',
    empty: 'هیچ رویدادی در دسترس نیست',
    event: 'رویداد',
    events: 'رویدادها',
    actionNum: '{{num}} {{event}} گنجانده شده',
    item: {
      parameters: 'پارامترهای {{count}}',
      noParameters: 'هیچ پارامتری',
    },
    output: 'خروجی',
  },
  node: {
    status: {
      warning: 'قطع ارتباط',
    },
  },
}

export default translation
