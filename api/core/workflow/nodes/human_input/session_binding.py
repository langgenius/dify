class SessionBinding:
    """Translate between graphon session ids and Dify form ids.

    Existing v1 session ids remain unchanged. V2 ids carry their form version
    so consumers do not have to infer ownership from node state or database lookups.
    """

    _V2_PREFIX = "hitlv2:"

    def issue_session_id_for_form(self, node_version: str, form_id: str) -> str:
        match node_version:
            case "1":
                return form_id
            case "2":
                return f"{self._V2_PREFIX}{form_id}"
            case _:
                raise ValueError(f"Unsupported Human Input node version: {node_version}")

    def resolve_form_id_from_session_id(self, session_id: str) -> tuple[str, str]:
        """Return the Human Input node version and the unprefixed form id."""
        if session_id.startswith(self._V2_PREFIX):
            return "2", session_id.removeprefix(self._V2_PREFIX)
        return "1", session_id


default_session_binding = SessionBinding()
