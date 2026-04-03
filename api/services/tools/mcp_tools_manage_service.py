        db_provider = self.get_provider(provider_id=provider_id, tenant_id=tenant_id)

        update_fields = {
            'tools': reconnect_result.tools,  # Ensure tools (including descriptions) are updated
            'encrypted_credentials': reconnect_result.encrypted_credentials,
            'is_authed': reconnect_result.authed,
            'updated_at': datetime.utcnow(),
