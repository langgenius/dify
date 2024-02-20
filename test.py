from xinference.client import Client

client = Client("http://localhost:9997")
model_uid = client.launch_model(
    model_name="llama-2-chat",
    model_format="ggmlv3", 
    model_size_in_billions=7,
    quantization="q2_K",
    )
model = client.get_model(model_uid)

chat_history = []
prompt = "hi"#{"role":"user", "content" : "最大的动物是什么？"}
model.chat(
    prompt,
    chat_history,
    generate_config={"max_tokens": 1024}
)