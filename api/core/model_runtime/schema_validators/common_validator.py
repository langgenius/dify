from typing import Union, cast

from core.model_runtime.entities.provider_entities import CredentialFormSchema, FormType


class CommonValidator:
    def _validate_and_filter_credential_form_schemas(
        self, credential_form_schemas: list[CredentialFormSchema], credentials: dict
    ):
        need_validate_credential_form_schema_map = {}
        for credential_form_schema in credential_form_schemas:
            if not credential_form_schema.show_on:
                need_validate_credential_form_schema_map[credential_form_schema.variable] = credential_form_schema
                continue

            all_show_on_match = True
            for show_on_object in credential_form_schema.show_on:
                if show_on_object.variable not in credentials:
                    all_show_on_match = False
                    break

                if credentials[show_on_object.variable] != show_on_object.value:
                    all_show_on_match = False
                    break

            if all_show_on_match:
                need_validate_credential_form_schema_map[credential_form_schema.variable] = credential_form_schema

        # Iterate over the remaining credential_form_schemas, verify each credential_form_schema
        validated_credentials = {}
        for credential_form_schema in need_validate_credential_form_schema_map.values():
            # add the value of the credential_form_schema corresponding to it to validated_credentials
            result = self._validate_credential_form_schema(credential_form_schema, credentials)
            if result:
                validated_credentials[credential_form_schema.variable] = result

        return validated_credentials

    def _validate_credential_form_schema(
        self, credential_form_schema: CredentialFormSchema, credentials: dict
    ) -> Union[str, bool, None]:
        """
        Validate credential form schema

        :param credential_form_schema: credential form schema
        :param credentials: credentials
        :return: validated credential form schema value
        """
        #  If the variable does not exist in credentials
        value: Union[str, bool, None] = None
        if credential_form_schema.variable not in credentials or not credentials[credential_form_schema.variable]:
            # If required is True, an exception is thrown
            if credential_form_schema.required:
                raise ValueError(f"Variable {credential_form_schema.variable} is required")
            else:
                # Get the value of default
                if credential_form_schema.default:
                    # If it exists, add it to validated_credentials
                    return credential_form_schema.default
                else:
                    # If default does not exist, skip
                    return None

        # Get the value corresponding to the variable from credentials
        value = cast(str, credentials[credential_form_schema.variable])

        # If max_length=0, no validation is performed
        if credential_form_schema.max_length:
            if len(value) > credential_form_schema.max_length:
                raise ValueError(
                    f"Variable {credential_form_schema.variable} length should not be"
                    f" greater than {credential_form_schema.max_length}"
                )

        # check the type of value
        if not isinstance(value, str):
            raise ValueError(f"Variable {credential_form_schema.variable} should be string")

        if credential_form_schema.type in {FormType.SELECT, FormType.RADIO}:
            # If the value is in options, no validation is performed
            if credential_form_schema.options:
                if value not in [option.value for option in credential_form_schema.options]:
                    raise ValueError(f"Variable {credential_form_schema.variable} is not in options")

        if credential_form_schema.type == FormType.SWITCH:
            # If the value is not in ['true', 'false'], an exception is thrown
            if value.lower() not in {"true", "false"}:
                raise ValueError(f"Variable {credential_form_schema.variable} should be true or false")

            value = value.lower() == "true"

        return value
