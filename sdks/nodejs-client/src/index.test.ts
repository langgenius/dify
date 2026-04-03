      "content-type": "multipart/form-data; boundary=test",
    });
    expect(init.body).not.toBe(form);
    expect((init as RequestInit & { duplex?: string }).duplex).toBe("half");
