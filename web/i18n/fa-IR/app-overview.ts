const translation = {
  welcome: {
    firstStepTip: 'برای شروع،',
    enterKeyTip: 'کلید API خود را در زیر وارد کنید',
    getKeyTip: 'کلید API خود را از داشبورد OpenAI دریافت کنید',
    placeholder: 'کلید API خود را وارد کنید (مثلاً sk-xxxx)',
  },
  apiKeyInfo: {
    cloud: {
      trial: {
        title: 'شما از سهمیه آزمایشی {{providerName}} استفاده می‌کنید.',
        description: 'سهمیه آزمایشی برای اهداف تست شما ارائه شده است. قبل از اینکه سهمیه آزمایشی تمام شود، لطفاً ارائه‌دهنده مدل خود را تنظیم کنید یا سهمیه اضافی خریداری کنید.',
      },
      exhausted: {
        title: 'سهمیه آزمایشی شما تمام شده است، لطفاً کلید API خود را تنظیم کنید.',
        description: 'شما سهمیه آزمایشی خود را مصرف کرده‌اید. لطفاً ارائه‌دهنده مدل خود را تنظیم کنید یا سهمیه اضافی خریداری کنید.',
      },
    },
    selfHost: {
      title: {
        row1: 'برای شروع،',
        row2: 'ابتدا ارائه‌دهنده مدل خود را تنظیم کنید.',
      },
    },
    callTimes: 'تعداد تماس‌ها',
    usedToken: 'توکن‌های مصرف‌شده',
    setAPIBtn: 'برو به تنظیمات ارائه‌دهنده مدل',
    tryCloud: 'یا نسخه ابری Dify با سهمیه رایگان را امتحان کنید',
  },
  overview: {
    title: 'نمای کلی',
    appInfo: {
      explanation: 'برنامه وب AI آماده به کار',
      accessibleAddress: 'آدرس عمومی',
      preview: 'پیش‌نمایش',
      regenerate: 'تولید مجدد',
      regenerateNotice: 'آیا می‌خواهید آدرس عمومی را دوباره تولید کنید؟',
      preUseReminder: 'لطفاً قبل از ادامه، WebApp را فعال کنید.',
      settings: {
        entry: 'تنظیمات',
        title: 'تنظیمات WebApp',
        webName: 'نام WebApp',
        webDesc: 'توضیحات WebApp',
        webDescTip: 'این متن در سمت مشتری نمایش داده می‌شود و راهنمایی‌های اولیه در مورد نحوه استفاده از برنامه را ارائه می‌دهد',
        webDescPlaceholder: 'توضیحات WebApp را وارد کنید',
        language: 'زبان',
        workflow: {
          title: 'مراحل کاری',
          show: 'نمایش',
          hide: 'مخفی کردن',
          showDesc: 'نمایش یا پنهان کردن جزئیات گردش کار در WebApp',
          subTitle: 'جزئیات گردش کار',
        },
        chatColorTheme: 'تم رنگی چت',
        chatColorThemeDesc: 'تم رنگی چت‌بات را تنظیم کنید',
        chatColorThemeInverted: 'معکوس',
        invalidHexMessage: 'مقدار هگز نامعتبر',
        more: {
          entry: 'نمایش تنظیمات بیشتر',
          copyright: 'حق نسخه‌برداری',
          copyRightPlaceholder: 'نام نویسنده یا سازمان را وارد کنید',
          privacyPolicy: 'سیاست حفظ حریم خصوصی',
          privacyPolicyPlaceholder: 'لینک سیاست حفظ حریم خصوصی را وارد کنید',
          privacyPolicyTip: 'به بازدیدکنندگان کمک می‌کند تا بفهمند برنامه چه داده‌هایی را جمع‌آوری می‌کند، به سیاست حفظ حریم خصوصی Dify نگاه کنید <privacyPolicyLink>Privacy Policy</privacyPolicyLink>.',
          customDisclaimer: 'سلب مسئولیت سفارشی',
          customDisclaimerPlaceholder: 'متن سلب مسئولیت سفارشی را وارد کنید',
          customDisclaimerTip: 'متن سلب مسئولیت سفارشی در سمت مشتری نمایش داده می‌شود و اطلاعات بیشتری درباره برنامه ارائه می‌دهد',
          copyrightTip: 'نمایش اطلاعات حق نسخه برداری در برنامه وب',
          copyrightTooltip: 'لطفا به طرح حرفه ای یا بالاتر ارتقا دهید',
        },
        sso: {
          title: 'WebApp SSO',
          label: 'احراز هویت SSO',
          description: 'همه کاربران باید قبل از استفاده از WebApp با SSO وارد شوند',
          tooltip: 'برای فعال کردن WebApp SSO با سرپرست تماس بگیرید',
        },
        modalTip: 'تنظیمات برنامه وب سمت مشتری.',
      },
      embedded: {
        entry: 'جاسازی شده',
        title: 'جاسازی در وب‌سایت',
        explanation: 'روش‌های جاسازی برنامه چت در وب‌سایت خود را انتخاب کنید',
        iframe: 'برای افزودن برنامه چت در هرجای وب‌سایت خود، این iframe را به کد HTML خود اضافه کنید.',
        scripts: 'برای افزودن برنامه چت به گوشه پایین سمت راست وب‌سایت خود، این کد را به HTML خود اضافه کنید.',
        chromePlugin: 'نصب افزونه Chrome Chatbot Dify',
        copied: 'کپی شد',
        copy: 'کپی',
      },
      qrcode: {
        title: 'کد QR لینک',
        scan: 'اسکن برای اشتراک‌گذاری',
        download: 'دانلود کد QR',
      },
      customize: {
        way: 'راه',
        entry: 'سفارشی‌سازی',
        title: 'سفارشی‌سازی WebApp AI',
        explanation: 'شما می‌توانید ظاهر جلویی برنامه وب را برای برآوردن نیازهای سناریو و سبک خود سفارشی کنید.',
        way1: {
          name: 'کلاینت را شاخه کنید، آن را تغییر دهید و در Vercel مستقر کنید (توصیه می‌شود)',
          step1: 'کلاینت را شاخه کنید و آن را تغییر دهید',
          step1Tip: 'برای شاخه کردن کد منبع به حساب GitHub خود و تغییر کد اینجا کلیک کنید',
          step1Operation: 'Dify-WebClient',
          step2: 'استقرار در Vercel',
          step2Tip: 'برای وارد کردن مخزن به Vercel و استقرار اینجا کلیک کنید',
          step2Operation: 'وارد کردن مخزن',
          step3: 'پیکربندی متغیرهای محیطی',
          step3Tip: 'متغیرهای محیطی زیر را در Vercel اضافه کنید',
        },
        way2: {
          name: 'نوشتن کد سمت کلاینت برای فراخوانی API و استقرار آن بر روی سرور',
          operation: 'مستندات',
        },
      },
      launch: 'راه اندازی',
    },
    apiInfo: {
      title: 'API سرویس بک‌اند',
      explanation: 'به راحتی در برنامه خود یکپارچه می‌شود',
      accessibleAddress: 'نقطه پایانی سرویس API',
      doc: 'مرجع API',
    },
    status: {
      running: 'در حال سرویس‌دهی',
      disable: 'غیرفعال',
    },
  },
  analysis: {
    title: 'تحلیل',
    ms: 'میلی‌ثانیه',
    tokenPS: 'توکن/ثانیه',
    totalMessages: {
      title: 'کل پیام‌ها',
      explanation: 'تعداد تعاملات روزانه با هوش مصنوعی.',
    },
    totalConversations: {
      title: 'کل مکالمات',
      explanation: 'تعداد مکالمات روزانه با هوش مصنوعی؛ مهندسی/اشکال‌زدایی پرامپت مستثنی است.',
    },
    activeUsers: {
      title: 'کاربران فعال',
      explanation: 'کاربران منحصر به فردی که در پرسش و پاسخ با AI شرکت می‌کنند؛ مهندسی/اشکال‌زدایی دستورات مستثنی هستند.',
    },
    tokenUsage: {
      title: 'استفاده از توکن',
      explanation: 'مصرف روزانه توکن‌های مدل زبان برای برنامه را نشان می‌دهد، که برای کنترل هزینه‌ها مفید است.',
      consumed: 'مصرف‌شده',
    },
    avgSessionInteractions: {
      title: 'میانگین تعاملات جلسه',
      explanation: 'تعداد تعاملات پیوسته کاربر-AI؛ برای برنامه‌های مبتنی بر گفتگو.',
    },
    avgUserInteractions: {
      title: 'میانگین تعاملات کاربران',
      explanation: 'تکرار استفاده روزانه کاربران را نشان می‌دهد. این معیار چسبندگی کاربران را نشان می‌دهد.',
    },
    userSatisfactionRate: {
      title: 'نرخ رضایت کاربران',
      explanation: 'تعداد لایک‌ها به ازای هر ۱۰۰۰ پیام. این نشان‌دهنده نسبت پاسخ‌هایی است که کاربران به شدت رضایت دارند.',
    },
    avgResponseTime: {
      title: 'میانگین زمان پاسخ',
      explanation: 'زمان (میلی‌ثانیه) برای پردازش/پاسخ AI؛ برای برنامه‌های مبتنی بر متن.',
    },
    tps: {
      title: 'سرعت خروجی توکن',
      explanation: 'عملکرد مدل زبان بزرگ را اندازه‌گیری می‌کند. سرعت خروجی توکن‌های مدل زبان بزرگ از آغاز درخواست تا تکمیل خروجی را بشمارید.',
    },
  },
}

export default translation
