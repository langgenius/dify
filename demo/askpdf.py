import os
import base64
import re
import json
import requests
import streamlit as st
from typing_extensions import override
from dotenv import load_dotenv
load_dotenv()


askyourpdf_key = os.environ.get("ASKYOURPDF_TEST_KEY")
assistant_title = "AskYourPDF API UI"
enabled_file_upload_message = os.environ.get(
    "ENABLED_FILE_UPLOAD_MESSAGE", "Upload a file"
)

headers = {
    'Content-Type': 'application/json',
    'x-api-key': askyourpdf_key
}

client = None


class EventHandler():
    @override
    def on_event(self, event):
        pass

    @override
    def on_text_created(self, text):
        st.session_state.current_message = ""
        with st.chat_message("Assistant"):
            st.session_state.current_markdown = st.empty()

    @override
    def on_text_delta(self, delta, snapshot):
        if snapshot.value:
            text_value = re.sub(
                r"\[(.*?)\]\s*\(\s*(.*?)\s*\)", "Download Link", snapshot.value
            )
            st.session_state.current_message = text_value
            st.session_state.current_markdown.markdown(
                st.session_state.current_message, True
            )

    @override
    def on_text_done(self, text):
        format_text = format_annotation(text)
        st.session_state.current_markdown.markdown(format_text, True)
        st.session_state.chat_log.append(
            {"name": "assistant", "msg": format_text})

    @override
    def on_tool_call_created(self, tool_call):
        if tool_call.type == "code_interpreter":
            st.session_state.current_tool_input = ""
            with st.chat_message("Assistant"):
                st.session_state.current_tool_input_markdown = st.empty()

    @override
    def on_tool_call_delta(self, delta, snapshot):
        if st.session_state.current_tool_input_markdown is None:
            with st.chat_message("Assistant"):
                st.session_state.current_tool_input_markdown = st.empty()

        if delta.type == "code_interpreter":
            if delta.code_interpreter.input:
                st.session_state.current_tool_input += delta.code_interpreter.input
                input_code = f"### code interpreter\ninput:\n```python\n{st.session_state.current_tool_input}\n```"
                st.session_state.current_tool_input_markdown.markdown(
                    input_code, True)

            if delta.code_interpreter.outputs:
                for output in delta.code_interpreter.outputs:
                    if output.type == "logs":
                        pass

    @override
    def on_tool_call_done(self, tool_call):
        st.session_state.tool_calls.append(tool_call)
        if tool_call.type == "code_interpreter":
            if tool_call.id in [x.id for x in st.session_state.tool_calls]:
                return
            input_code = f"### code interpreter\ninput:\n```python\n{tool_call.code_interpreter.input}\n```"
            st.session_state.current_tool_input_markdown.markdown(
                input_code, True)
            st.session_state.chat_log.append(
                {"name": "assistant", "msg": input_code})
            st.session_state.current_tool_input_markdown = None
            for output in tool_call.code_interpreter.outputs:
                if output.type == "logs":
                    output = f"### code interpreter\noutput:\n```\n{output.logs}\n```"
                    with st.chat_message("Assistant"):
                        st.markdown(output, True)
                        st.session_state.chat_log.append(
                            {"name": "assistant", "msg": output}
                        )
        elif (
            tool_call.type == "function"
            and self.current_run.status == "requires_action"
        ):
            with st.chat_message("Assistant"):
                msg = f"### Function Calling: {tool_call.function.name}"
                st.markdown(msg, True)
                st.session_state.chat_log.append(
                    {"name": "assistant", "msg": msg})
            tool_calls = self.current_run.required_action.submit_tool_outputs.tool_calls
            tool_outputs = []
            for submit_tool_call in tool_calls:
                tool_function_name = submit_tool_call.function.name
                tool_function_arguments = json.loads(
                    submit_tool_call.function.arguments
                )
                tool_function_output = TOOL_MAP[tool_function_name](
                    **tool_function_arguments
                )
                tool_outputs.append(
                    {
                        "tool_call_id": submit_tool_call.id,
                        "output": tool_function_output,
                    }
                )

            with client.beta.threads.runs.submit_tool_outputs_stream(
                thread_id=st.session_state.thread.id,
                run_id=self.current_run.id,
                tool_outputs=tool_outputs,
                event_handler=EventHandler(),
            ) as stream:
                stream.until_done()


def create_thread(content, file):
    messages = [
        {
            "role": "user",
            "content": content,
        }
    ]
    if file is not None:
        messages[0].update({"file_ids": [file.id]})
    thread = client.beta.threads.create()
    return thread


def create_message(thread, content, file):
    attachments = []
    print('!!!!!!!create_message: ', file)
    if file is not None:
        attachments.append(file.id
                           # {"file_id": file.id, "tools": [{"type": "code_interpreter"}]}
                           )
    print('!!!!!!!create_message, attachments: ', attachments)
    client.beta.threads.messages.create(
        thread_id=thread.id, role="user", content=content, file_ids=attachments
    )


def create_file_link(file_name, file_id):
    content = client.files.content(file_id)
    content_type = content.response.headers["content-type"]
    b64 = base64.b64encode(content.text.encode(content.encoding)).decode()
    link_tag = f'<a href="data:{content_type};base64,{b64}" download="{file_name}">Download Link</a>'
    return link_tag


def format_annotation(text):
    citations = []
    text_value = text.value
    for index, annotation in enumerate(text.annotations):
        text_value = text.value.replace(annotation.text, f" [{index}]")

        if file_citation := getattr(annotation, "file_citation", None):
            cited_file = client.files.retrieve(file_citation.file_id)
            citations.append(
                f"[{index}] {file_citation.quote} from {cited_file.filename}"
            )
        elif file_path := getattr(annotation, "file_path", None):
            link_tag = create_file_link(
                annotation.text.split("/")[-1],
                file_path.file_id,
            )
            text_value = re.sub(
                r"\[(.*?)\]\s*\(\s*(.*?)\s*\)", link_tag, text_value
            )
    text_value += "\n\n" + "\n".join(citations)
    return text_value


def run_stream(user_input, file):
    # if "thread" not in st.session_state:
    #     st.session_state.thread = create_thread(user_input, file)
    # create_message(st.session_state.thread, user_input, file)
    # with client.beta.threads.runs.stream(
    #     thread_id=st.session_state.thread.id,
    #     assistant_id=assistant_id,
    #     event_handler=EventHandler(),
    # ) as stream:
    #     stream.until_done()

    data = [
        {
            "sender": "User",
            "message": user_input
        }
    ]

    response = requests.post('https://api.askyourpdf.com/v1/chat/' +
                             file.docId + '?model_name=GPT4', headers=headers, data=json.dumps(data))

    if response.status_code == 200:
        print(response.json())
        st.session_state.chat_log.append(
            {"name": "assistant", "msg": response.json()['answer']['message']})
    else:
        print('Error:', response.status_code)


def handle_uploaded_file(uploaded_file):
    # file = client.files.create(file=uploaded_file, purpose="assistants")
    response = requests.post('https://api.askyourpdf.com/v1/api/upload',
                             headers=headers, files={'file': uploaded_file})

    if response.status_code == 201:
        print(response.json())
    else:
        print('Error:', response.status_code)

    return response


def render_chat():
    for chat in st.session_state.chat_log:
        with st.chat_message(chat["name"]):
            st.markdown(chat["msg"], True)


if "tool_call" not in st.session_state:
    st.session_state.tool_calls = []

if "chat_log" not in st.session_state:
    st.session_state.chat_log = []

if "in_progress" not in st.session_state:
    st.session_state.in_progress = False


def disable_form():
    st.session_state.in_progress = True


class TestFile:
    def __init__(self):
        self.docId = None


def main():
    st.title(assistant_title)
    user_msg = st.chat_input(
        "Message", on_submit=disable_form, disabled=st.session_state.in_progress
    )
    if enabled_file_upload_message:
        uploaded_file = st.sidebar.file_uploader(
            enabled_file_upload_message,
            type=["pdf"],
            disabled=st.session_state.in_progress,
        )
    else:
        uploaded_file = None
    if user_msg:
        render_chat()
        with st.chat_message("user"):
            st.markdown(user_msg, True)
        st.session_state.chat_log.append({"name": "user", "msg": user_msg})

        file = None
        # if uploaded_file is not None:
        #     file = handle_uploaded_file(uploaded_file)
        file = TestFile()
        file.docId = 'a8389bce-eacb-451f-aa9b-49bbf014b7c7'
        # print('!!!!!!!main: ', file.docId)
        run_stream(user_msg, file)
        st.session_state.in_progress = False
        st.session_state.tool_call = None
        st.rerun()
    render_chat()


if __name__ == "__main__":
    main()


# How does the Transformer model compare to existing models in terms of performance and training time? 用中文回答
