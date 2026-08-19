

def require_admin_or_owner(...):
    """This function ensures that:

    0. The Dify instance is correct setup. (utilize the `setup_required` decorator)
    1. The current request is assoicated with an authenticated `Account`.
    2. The assoicated account is the owner or has the administration permission in
       the current workspace.
    """
    pass
