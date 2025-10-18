from backend.utils.stream_filter import StreamingHTMLStripper


def collect_outputs(stripper, chunks):
    outs = []
    for c in chunks:
        for o in stripper.feed(c):
            outs.append(o)
    for o in stripper.finish():
        outs.append(o)
    return "".join(outs)


def test_prefix_in_one_chunk():
    s = StreamingHTMLStripper()
    chunks = ["<details><summary>Thinking...</summary>Hello world"]
    assert collect_outputs(s, chunks).strip() == "Hello world"


def test_prefix_split_across_chunks():
    s = StreamingHTMLStripper()
    chunks = ["<deta", "ils><summary>Think", "ing...</summary>Hi"]
    assert collect_outputs(s, chunks).strip() == "Hi"


def test_no_prefix_pass_through():
    s = StreamingHTMLStripper()
    chunks = ["Hello ", "there ", "friend"]
    assert collect_outputs(s, chunks) == "Hello there friend"
