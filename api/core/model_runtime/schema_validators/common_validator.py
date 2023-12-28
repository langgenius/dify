from typing import Optional

from core.model_runtime.entities.provider_entities import FormType, CredentialFormSchema


class CommonValidator:
    def _validate_and_filter_credential_form_schemas(self,
                                                     credential_form_schemas: list[CredentialFormSchema],
                                                     credentials: dict) -> dict:
        # extract the show_on relationship in credential_form_schemas
        # show_on is a dict, key is the parent variable, value is the list of child CredentialFormSchema
        show_on_relations = {}
        for credential_form_schema in credential_form_schemas:
            show_on = credential_form_schema.show_on
            for show_on_object in show_on:
                variable = show_on_object.variable
                if variable not in show_on_relations:
                    show_on_relations[variable] = []
                show_on_relations[variable].append(credential_form_schema)

        # If the variable does not exist in credentials, it is considered that the cascading form item is not displayed
        need_validate_credential_form_schemas = []
        for variable, sub_credential_form_schemas in show_on_relations.items():
            if variable in credentials and credentials[variable] is not None:
                for sub_credential_form_schema in sub_credential_form_schemas:
                    show_on = sub_credential_form_schema.show_on
                    for show_on_object in show_on:
                        if show_on_object.variable == variable and show_on_object.value == credentials[variable]:
                            need_validate_credential_form_schemas.append(sub_credential_form_schema)
                            break

        # remove duplicate
        need_validate_credential_form_schemas = list(set(need_validate_credential_form_schemas))

        # get all credential_form_schemas where show_on is empty
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema in need_validate_credential_form_schemas:
                continue

            if credential_form_schema.show_on:
                continue

            need_validate_credential_form_schemas.append(credential_form_schema)

        # Iterate over the remaining credential_form_schemas, verify each credential_form_schema
        validated_credentials = {}
        for credential_form_schema in need_validate_credential_form_schemas:
            # add the value of the credential_form_schema corresponding to it to validated_credentials
            result = self._validate_credential_form_schema(credential_form_schema, credentials)
            if result:
                validated_credentials[credential_form_schema.variable] = result

        return validated_credentials

    def _validate_credential_form_schema(self, credential_form_schema: CredentialFormSchema, credentials: dict) \
            -> Optional[str]:
        """
        Validate credential form schema

        :param credential_form_schema: credential form schema
        :param credentials: credentials
        :return: validated credential form schema value
        """
        #  If the variable does not exist in credentials
        if credential_form_schema.variable not in credentials:
            # If required is True, an exception is thrown
            if credential_form_schema.required:
                raise ValueError(f'Variable {credential_form_schema.variable} is required')
            else:
                # Get the value of default
                if credential_form_schema.default:
                    # If it exists, add it to validated_credentials
                    return credential_form_schema.default
                else:
                    # If default does not exist, skip
                    return None

        # Get the value corresponding to the variable from credentials
        value = credentials[credential_form_schema.variable]

        # If max_length=0, no validation is performed
        if credential_form_schema.max_length:
            if len(value) > credential_form_schema.max_length:
                raise ValueError(f'Variable {credential_form_schema.variable} length should not greater than {credential_form_schema.max_length}')

        # check the type of value
        if not isinstance(value, str):
            raise ValueError(f'Variable {credential_form_schema.variable} should be string')

        if credential_form_schema.type in [FormType.SELECT, FormType.RADIO]:
            # If the value is in options, no validation is performed
            if credential_form_schema.options:
                if value not in [option.value for option in credential_form_schema.options]:
                    raise ValueError(f'Variable {credential_form_schema.variable} is not in options')

        if credential_form_schema.type == FormType.SWITCH:
            # If the value is not in ['true', 'false'], an exception is thrown
            if value.lower() not in ['true', 'false']:
                raise ValueError(f'Variable {credential_form_schema.variable} should be true or false')

            value = True if value.lower() == 'true' else False

        return value
