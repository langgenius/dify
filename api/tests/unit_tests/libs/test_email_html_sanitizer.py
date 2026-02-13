from configs.feature import MailHtmlSanitizerProfile
from libs.email_html_sanitizer import sanitize_email_html, sanitize_email_subject


def test_sanitize_email_html_strips_script_tags():
    html = "<div>ok</div><script>alert(1)</script>"
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.STRICT)
    assert "<script" not in result


def test_sanitize_email_html_strips_event_handlers():
    html = '<img src="https://example.com/x.png" onerror="alert(1)">'
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.STRICT)
    assert "onerror" not in result


def test_sanitize_email_html_strips_javascript_url():
    html = '<a href="javascript:alert(1)">link</a>'
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.STRICT)
    assert "javascript:" not in result


def test_sanitize_email_html_keeps_allowed_img_src():
    html = '<img src="cid:logo.png" alt="x">'
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.STRICT)
    assert "cid:logo.png" in result


def test_sanitize_email_html_balanced_allows_safe_styles():
    html = '<div style="color: red; position: fixed">x</div>'
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.BALANCED)
    assert "color" in result
    assert "position" not in result


def test_sanitize_email_html_strict_blocks_remote_images():
    html = '<img src="https://example.com/x.png" alt="x">'
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.STRICT)
    assert "https://example.com/x.png" not in result


def test_sanitize_email_html_free_keeps_input():
    html = "<script>alert(1)</script>"
    result = sanitize_email_html(html, profile=MailHtmlSanitizerProfile.FREE)
    assert result == html


def test_sanitize_email_subject_strips_control_chars():
    subject = "Hello\r\nBcc:\x01 victim@example.com\x7f\t<b>hi</b>"
    result = sanitize_email_subject(subject)
    assert "\r" not in result
    assert "\n" not in result
    assert "\x01" not in result
    assert "\x7f" not in result
    assert "\t" in result


def test_sanitize_email_subject_keeps_literal_angle_brackets():
    subject = "2 < 3 and <3"
    result = sanitize_email_subject(subject)
    assert result == subject


def test_sanitize_email_subject_keeps_html_tags():
    subject = "<i>hello</i>"
    result = sanitize_email_subject(subject)
    assert result == subject
