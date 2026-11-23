"""Load the component-library prompt generated with the frontend registry."""

from functools import cache
from pathlib import Path


@cache
def load_generative_ui_prompt(*, read_only: bool = False) -> str:
    """Return the system prompt instructions for Generative UI generation.

    Preconditions: generated grammar and example resource files exist under
        ``api/resources/generative_ui/``.
    Postconditions: returns full interactive prompt when ``read_only`` is False,
        or display-only visualization prompt (excluding ActionButton/Form/fields)
        when ``read_only`` is True.
    """
    resources_dir = Path(__file__).resolve().parents[1] / "resources/generative_ui"
    if read_only:
        grammar = (resources_dir / "dify-ui-v1-readonly.txt").read_text()
        examples = (resources_dir / "response-examples-readonly.txt").read_text()
        return (
            (
                "Intelligent UI is an optional read-only presentation capability, not a requirement for every output. "
                "By default, use ordinary text for simple explanations, summaries without structured metrics, "
                "or when plain text is requested. "
                "Use UI when structured data, visual comparisons, or trends make the output easier to read. "
                "Do not add Text, Heading, or Card components merely to restate prose. "
                "The component grammar below applies only when a UI block is useful."
            )
            + "\n\n"
            + grammar
            + "\n\n"
            + (
                "Dify response transport: a text-only output has no <dify_ui> tag or empty UI program. "
                "Compose prose and UI as one report, in the order the reader should read them. "
                "Prose owns conclusions, explanations, uncertainty, and recommendations. Charts, tables, "
                "and metric cards own the detailed values, comparisons, and trends. "
                "A short conclusion may cite a key value, but do not enumerate the same dataset in prose "
                "and UI or restate a metric card in another card. "
                "Put each complete OpenUI program inside a <dify_ui>...</dify_ui> block whose opening line is "
                "exactly <dify_ui> and whose closing line is exactly </dify_ui>. Put UI blocks between complete "
                "paragraphs, never inside a sentence, list, table, or code fence. Text may follow a UI block. "
                "Explain the important conclusion in prose without copying all UI details. "
                "Missing values are unknown, not zero; omit comparisons that require unavailable data. "
                "This workflow output is strictly read-only: use only the registered display components. "
                "Never generate ActionButton, Form, TextField, SelectField, Query, Mutation, URLs, "
                "executable JavaScript, or HTML."
            )
            + "\n\nComplete response examples:\n"
            + examples
        )

    grammar = (resources_dir / "dify-ui-v1.txt").read_text()
    examples = (resources_dir / "response-examples.txt").read_text()
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
            "Dify response transport: a text-only answer has no <dify_ui> tag or empty UI program. "
            "Compose prose and UI as one answer, in the order the user should read them. "
            "Prose owns conclusions, explanations, uncertainty, and next steps. Charts and tables own "
            "the detailed values, comparisons, and trends; forms own collecting input. "
            "A short conclusion may cite a key value, but do not enumerate the same dataset in prose "
            "and UI or restate a metric card in another card. "
            "Put each complete OpenUI program inside a <dify_ui>...</dify_ui> block whose opening line is "
            "exactly <dify_ui> and whose closing line is exactly </dify_ui>. Put UI blocks between complete "
            "paragraphs, never inside a sentence, list, table, or code fence. Text may follow a UI block. "
            "Conversation history retains completed UI content, so do not repeat its data merely for memory. "
            "Explain the important conclusion in prose without copying all UI details. "
            "Missing values are unknown, not zero; omit comparisons that require unavailable data. "
            "Use only the registered components and continuation actions. Do not generate Query, Mutation, "
            "URLs, executable JavaScript, or HTML. UI form submissions start a new user turn. "
            "Generate UI only in the final user-facing response, after any tool calls have completed."
        )
        + "\n\nComplete response examples:\n"
        + examples
    )
