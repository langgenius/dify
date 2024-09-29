from flask_restful import Resource, fields, reqparse,marshal

from controllers.console.setup import setup_required
from controllers.inner_api import api
from controllers.inner_api.wraps import inner_api_only
from events.tenant_event import tenant_was_created
from models.account import Account
from services.app_service import AppService
from services.api_key_service import AppKeyService
from services.dataset_service import DatasetService
from constants.model_template import default_app_detail
from models.model import App, AppMode, AppModelConfig,ApiToken
from controllers.service_api.dataset.error import DatasetNameDuplicateError
from werkzeug.exceptions import BadRequest


class App(Resource):
    @setup_required
    @inner_api_only
    def get(self):
        pass

    @setup_required
    @inner_api_only
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("tenant_id", type=str, required=True, location="json")
        parser.add_argument("email", type=str, required=True, location="json")
        parser.add_argument("name", type=str, required=True, location="json")
        parser.add_argument("description", type=str, required=True, location="json")
        parser.add_argument("mode", type=str, required=True, location="json")
        parser.add_argument("pre_prompt", type=str, required=True, location="json")
        parser.add_argument("opening_statement", type=str, required=True, location="json")
        parser.add_argument("language", type=str, required=True, location="json")
        parser.add_argument("dataset_name", type=str, required=True, location="json")
        args = parser.parse_args()
        # 根据mode添加对应的app_detail信息
        app_mode = AppMode.value_of(args["mode"])
        app_template = default_app_detail[app_mode]
        if app_template:
            args["icon_type"] = app_template.get("icon_type", "emoji")
            args["icon"] = app_template.get("icon", "🤖")
            args["icon_background"] = app_template.get("icon_background", "#FFEAD5")
        else:
            return {"message": f"不支持的应用模式: {args['mode']}"}, 200

        # 根据email查找account
        account = None
        if args.get("email"):
            account = Account.query.filter_by(email=args["email"]).first()
        
        if not account:
            return {"message": "未找到对应的租户账户。"}, 200
            
        account.current_tenant_id = args["tenant_id"]
        
        if not args["dataset_name"] or args["dataset_name"] == "":
            return {"message": "知识库名字为空"}, 200
        try:
            dataset = DatasetService.create_empty_dataset(
                tenant_id=args["tenant_id"],
                name=args["dataset_name"],
                indexing_technique="high_quality",
                account=account,
                permission="all_team_members",
            )
            args["dataset_id"] = dataset.id
        except DatasetNameDuplicateError:
            return {"message": "The dataset name already exists. Please modify your dataset name"}, 200

        app_service = AppService() 
        api_key_service = AppKeyService()
        try:
            app = app_service.create_app(args["tenant_id"], args, account)
            # 创建token
            api_token = api_key_service.newApiKey(account,str(app.id),"app","app_id","app-")
            return {"message": "应用创建成功。", "app_id": str(app.id), "api_key":api_token.token,"dataset_id": args["dataset_id"]}, 200
        except Exception as e:
            return {"message": f"创建应用失败: {str(e)}"}, 200
    
    @setup_required
    @inner_api_only
    def put(self):
        pass
    
    @setup_required
    @inner_api_only
    def delete(self):
        pass


api.add_resource(App, "/enterprise/apps")
