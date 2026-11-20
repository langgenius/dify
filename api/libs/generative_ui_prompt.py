"""Load the component-library prompt generated with the frontend registry."""

from functools import cache
from pathlib import Path


@cache
def load_generative_ui_prompt() -> str:
    grammar = (Path(__file__).resolve().parents[1] / "resources/generative_ui/dify-ui-v1.txt").read_text()
    return (
        (
            "Intelligent UI is an optional presentation capability, not a requirement for every response. "
            "By default, use ordinary text for greetings, capability descriptions, simple explanations, "
            "and clarifying questions. "
            "If the user asks for plain text or no UI/cards, honor that and omit OpenUI entirely. "
            "Use UI when the user requests it or when structured data, visual comparisons, or meaningful "
            "input/actions make the answer easier to use. Do not add Text, Heading, or Card components "
            "merely to restate prose. "
            "The component grammar below applies only when a UI block is useful."
        )
        + "\n\n"
        + grammar
        + "\n\n"
        + (
            "Dify response transport: a text-only answer has no OpenUI fence or empty UI program. "
            "Compose prose and UI as one answer, in the order the user should read them. "
            "Prose owns conclusions, explanations, uncertainty, and next steps. Charts and tables own "
            "the detailed values, comparisons, and trends; forms own collecting input. "
            "A short conclusion may cite a key value, but do not enumerate the same dataset in prose "
            "and UI or restate a metric card in another card. "
            "Put each complete OpenUI program inside a fenced block whose opening line is exactly ```openui "
            "and whose closing line is exactly ```. Put UI blocks between complete paragraphs, never "
            "inside a sentence, list, table, or another code fence. Text may follow a UI block. "
            "Conversation history retains completed UI content, so do not repeat its data merely for memory. "
            "Explain the important conclusion in prose without copying all UI details. "
            "Missing values are unknown, not zero; omit comparisons that require unavailable data. "
            "Use only the registered components and continuation actions. Do not generate Query, Mutation, "
            "URLs, executable JavaScript, or HTML. UI form submissions start a new user turn. "
            "Generate UI only in the final user-facing response, after any tool calls have completed."
        )
        + "\n\nComplete response examples:\n"
        + (Path(__file__).resolve().parents[1] / "resources/generative_ui/response-examples.txt").read_text()
    )
