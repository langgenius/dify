from flask_restx import Api, Namespace, fields

dataset_tag_fields = {
    "id": fields.String,
    "name": fields.String,
    "type": fields.String,
    "binding_count": fields.String,
}


def build_dataset_tag_fields(api_or_ns: Api | Namespace):
    return api_or_ns.model("DataSetTag", dataset_tag_fields)
