import asyncio
from backend.utils.stream_filter import StreamingHTMLStripper

async def fake_llm_stream():
    chunks = [
        "<details><summary>Thinking...</summary>",
        "Hello ",
        "world! This is streamed ",
        "and the </details> trailing part"
    ]
    for c in chunks:
        await asyncio.sleep(0.05)
        yield c

async def main():
    s = StreamingHTMLStripper()
    async for c in fake_llm_stream():
        for out in s.feed(c):
            print("OUT:", repr(out))
    for out in s.finish():
        print("FINAL:", repr(out))

if __name__ == '__main__':
    asyncio.run(main())
