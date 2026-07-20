class SessionBinding:
    """Translate between graphon session ids and Dify form ids.

    Phase 1 keeps the public graphon `session_id` contract while Dify continues
    to persist and query `form_id`. The identity mapping lives here so later
    phases can change the translation without scattering equality assumptions.
    """

    def issue_session_id_for_form(self, *, form_id: str) -> str:
        return form_id

    def resolve_form_id_from_session_id(self, *, session_id: str) -> str:
        return session_id


default_session_binding = SessionBinding()
