const translation = {
  subscription: {
    title: 'การสมัครสมาชิก',
    listNum: 'การสมัครสมาชิก {{num}}',
    empty: {
      title: 'ไม่มีการสมัครสมาชิก',
      button: 'สมัครสมาชิกใหม่',
    },
    createButton: {
      oauth: 'การสมัครสมาชิกใหม่ด้วย OAuth',
      apiKey: 'การสมัครสมาชิกใหม่ด้วยคีย์ API',
      manual: 'วาง URL เพื่อสร้างการสมัครสมาชิกใหม่',
    },
    createSuccess: 'การสมัครสมาชิกสร้างเรียบร้อยแล้ว',
    createFailed: 'ไม่สามารถสร้างการสมัครสมาชิกได้',
    maxCount: 'สมาชิกสูงสุด {{num}}',
    selectPlaceholder: 'เลือกการสมัครสมาชิก',
    noSubscriptionSelected: 'ยังไม่ได้เลือกการสมัครสมาชิก',
    subscriptionRemoved: 'ยกเลิกการสมัครแล้ว',
    list: {
      title: 'การสมัครสมาชิก',
      addButton: 'เพิ่ม',
      tip: 'รับเหตุการณ์ผ่านการสมัครสมาชิก',
      item: {
        enabled: 'เปิดใช้งาน',
        disabled: 'ปิดการใช้งาน',
        credentialType: {
          api_key: 'คีย์ API',
          oauth2: 'OAuth',
          unauthorized: 'คู่มือ',
        },
        actions: {
          delete: 'ลบ',
          deleteConfirm: {
            title: 'ลบ {{name}} หรือไม่?',
            success: 'การสมัครสมาชิก {{name}} ถูกลบเรียบร้อยแล้ว',
            error: 'ลบการสมัครสมาชิก {{name}} ไม่สำเร็จ',
            content: 'เมื่อถูกลบแล้ว การสมัครสมาชิกนี้ไม่สามารถกู้คืนได้ กรุณายืนยัน',
            contentWithApps: 'การสมัครสมาชิกปัจจุบันถูกอ้างอิงโดยแอปพลิเคชัน {{count}} การลบการสมัครสมาชิกนี้จะทำให้แอปพลิเคชันที่ถูกกำหนดค่าไม่สามารถรับเหตุการณ์การสมัครสมาชิกได้',
            confirm: 'ยืนยันการลบ',
            cancel: 'ยกเลิก',
            confirmInputWarning: 'กรุณาใส่ชื่อที่ถูกต้องเพื่อยืนยัน',
            confirmInputPlaceholder: 'ใส่ "{{name}}" เพื่อยืนยัน',
            confirmInputTip: 'โปรดใส่ “{{name}}” เพื่อยืนยัน',
          },
        },
        status: {
          active: 'ใช้งานอยู่',
          inactive: 'ไม่ทำงาน',
        },
        usedByNum: 'ใช้โดยเวิร์กโฟลว์ {{num}}',
        noUsed: 'ไม่ได้ใช้เวิร์กโฟลว์',
      },
    },
    addType: {
      title: 'เพิ่มการสมัครสมาชิก',
      description: 'เลือกวิธีที่คุณต้องการสร้างการสมัครรับข้อมูลทริกเกอร์ของคุณ',
      options: {
        apikey: {
          title: 'สร้างด้วยคีย์ API',
          description: 'สร้างการสมัครสมาชิกโดยอัตโนมัติโดยใช้ข้อมูลรับรอง API',
        },
        oauth: {
          title: 'สร้างด้วย OAuth',
          description: 'อนุญาตการใช้งานกับแพลตฟอร์มภายนอกเพื่อสร้างการสมัครสมาชิก',
          clientSettings: 'การตั้งค่าไคลเอนต์ OAuth',
          clientTitle: 'ไคลเอนต์ OAuth',
          default: 'ค่าเริ่มต้น',
          custom: 'กำหนดเอง',
        },
        manual: {
          title: 'การตั้งค่าแบบแมนนวล',
          description: 'วาง URL เพื่อสร้างการสมัครสมาชิกใหม่',
          tip: 'กำหนดค่า URL บนแพลตฟอร์มของบุคคลที่สามด้วยตนเอง',
        },
      },
    },
  },
  modal: {
    steps: {
      verify: 'ยืนยัน',
      configuration: 'การกำหนดค่า',
    },
    common: {
      cancel: 'ยกเลิก',
      back: 'กลับ',
      next: 'ถัดไป',
      create: 'สร้าง',
      verify: 'ยืนยัน',
      authorize: 'อนุญาต',
      creating: 'กำลังสร้าง...',
      verifying: 'กำลังตรวจสอบ...',
      authorizing: 'กำลังอนุมัติ...',
    },
    oauthRedirectInfo: 'เนื่องจากไม่พบรหัสลับของระบบลูกค้าสำหรับผู้ให้บริการเครื่องมือนี้ จำเป็นต้องตั้งค่าเอง สำหรับ redirect_uri กรุณาใช้',
    apiKey: {
      title: 'สร้างด้วยคีย์ API',
      verify: {
        title: 'ตรวจสอบข้อมูลรับรอง',
        description: 'กรุณาให้ข้อมูลรับรอง API ของคุณเพื่อยืนยันการเข้าถึง',
        error: 'การตรวจสอบข้อมูลรับรองล้มเหลว โปรดตรวจสอบคีย์ API ของคุณ',
        success: 'การยืนยันข้อมูลประจำตัวสำเร็จ',
      },
      configuration: {
        title: 'ตั้งค่าการสมัครสมาชิก',
        description: 'ตั้งค่าพารามิเตอร์การสมัครของคุณ',
      },
    },
    oauth: {
      title: 'สร้างด้วย OAuth',
      authorization: {
        title: 'การอนุญาต OAuth',
        description: 'อนุญาตให้ Dify เข้าถึงบัญชีของคุณ',
        redirectUrl: 'เปลี่ยนเส้นทาง URL',
        redirectUrlHelp: 'ใช้ URL นี้ในการตั้งค่าแอป OAuth ของคุณ',
        authorizeButton: 'อนุญาตด้วย {{provider}}',
        waitingAuth: 'กำลังรอการอนุญาต...',
        authSuccess: 'การอนุญาตสำเร็จ',
        authFailed: 'ไม่สามารถดึงข้อมูลการอนุญาต OAuth ได้',
        waitingJump: 'ได้รับอนุญาต กำลังรอการบินขึ้น',
      },
      configuration: {
        title: 'ตั้งค่าการสมัครสมาชิก',
        description: 'ตั้งค่าพารามิเตอร์การสมัครของคุณหลังจากได้รับอนุญาต',
        success: 'การตั้งค่า OAuth สำเร็จ',
        failed: 'การตั้งค่า OAuth ล้มเหลว',
      },
      remove: {
        success: 'การลบ OAuth สำเร็จ',
        failed: 'การลบ OAuth ล้มเหลว',
      },
      save: {
        success: 'บันทึกการตั้งค่า OAuth สำเร็จแล้ว',
      },
    },
    manual: {
      title: 'การตั้งค่าด้วยตนเอง',
      description: 'ตั้งค่าการสมัครสมาชิกเว็บฮุคของคุณด้วยตนเอง',
      logs: {
        title: 'บันทึกคำขอ',
        request: 'คำขอ',
        loading: 'กำลังรอคำขอจาก {{pluginName}} ...',
      },
    },
    form: {
      subscriptionName: {
        label: 'ชื่อการสมัครสมาชิก',
        placeholder: 'ใส่ชื่อการสมัครสมาชิก',
        required: 'จำเป็นต้องระบุชื่อการสมัครสมาชิก',
      },
      callbackUrl: {
        label: 'URL สำหรับเรียกกลับ',
        description: 'URL นี้จะได้รับเหตุการณ์เว็บฮุค',
        tooltip: 'จัดเตรียมจุดปลายทางที่สามารถเข้าถึงได้สาธารณะเพื่อรับคำขอกลับเรียกจากผู้ให้บริการทริกเกอร์',
        placeholder: 'กำลังสร้าง...',
        privateAddressWarning: 'URL นี้ดูเหมือนจะเป็นที่อยู่ภายใน ซึ่งอาจทำให้การร้องขอ webhook ล้มเหลว คุณสามารถเปลี่ยน TRIGGER_URL เป็นที่อยู่สาธารณะได้',
      },
    },
    errors: {
      createFailed: 'ไม่สามารถสร้างการสมัครสมาชิกได้',
      verifyFailed: 'ไม่สามารถตรวจสอบข้อมูลประจำตัวได้',
      authFailed: 'การอนุญาตล้มเหลว',
      networkError: 'เกิดข้อผิดพลาดของเครือข่าย กรุณาลองใหม่',
    },
  },
  events: {
    title: 'กิจกรรมที่มีอยู่',
    description: 'เหตุการณ์ที่ปลั๊กอินทริกเกอร์นี้สามารถสมัครรับได้',
    empty: 'ไม่มีเหตุการณ์ใดๆ',
    event: 'งานกิจกรรม',
    events: 'เหตุการณ์',
    actionNum: '{{num}} {{event}} รวมอยู่ด้วย',
    item: {
      parameters: 'พารามิเตอร์ {{count}}',
      noParameters: 'ไม่มีพารามิเตอร์',
    },
    output: 'ผลลัพธ์',
  },
  node: {
    status: {
      warning: 'ตัดการเชื่อมต่อ',
    },
  },
}

export default translation
