import logging
import yaml
from typing import Optional
import flask_login
from pathlib import Path
from constants.languages import languages
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.manager.exc import PluginDaemonClientSideError
from extensions.ext_database import db
from models.account import (
    Account,
    Tenant,
)
from services.account_service import AccountService, TenantService
from services.dataset_service import DatasetService
from services.errors.account import (
    AccountRegisterError,
    TenantNotFoundError,
)
from services.errors.workspace import WorkSpaceNotAllowedCreateError
from services.ext.dataset_ext_service import DatasetExtService
from services.model_load_balancing_service import ModelLoadBalancingService
from services.model_provider_service import ModelProviderService
from services.plugin.plugin_service import PluginService
from configs import dify_config
from configs.ext_config import get_ext_config
import os

class AccountInfo:
    def __init__(self, email, name, user_id, tenant_id):
        self.email = email
        self.name = name
        self.user_id=user_id
        self.tenant_id=tenant_id
    def to_dict(self):
        return {
            "tenant_id": self.email,
            "tenant_name": self.name,
            "api_key": self.tenant_id,
        }

class TenantAccountInfo:
    def __init__(self, tenant_id:str,
                 tenant_name:str,
                 admin_account:str,
                 admin_account_password:str,
                 ):
        self.tenant_id = tenant_id
        self.tenant_name = tenant_name
        self.admin_account=admin_account
        self.admin_account_password=admin_account_password

    def to_dict(self):
        return {
            "tenant_id": self.tenant_id,
            "tenant_name": self.tenant_name,
            "admin_account": self.admin_account,
            "admin_account_password": self.admin_account_password,
        }

class TenantData:
    def __init__(self,
                 api_key:str,
                 dataset_ids:list[str]
                 ):
        self.api_key=api_key
        self.dataset_ids=dataset_ids

    def to_dict(self):
        return {
            "api_key": self.api_key,
            "dataset_ids": self.dataset_ids,
        }

class AccountExtService:

    @staticmethod
    def create_account_and_tenant(
        email: str,
        name: str,
        tenant_name: str,
        target_tenant_id: str,
        interface_language: Optional[str] = None,
        password: Optional[str] = None
    ) -> Account:
        """create account"""
        account = AccountService.create_account(
            email=email, name=name, interface_language=interface_language, password=password, is_setup=True
        )
        account.target_tenant_id = target_tenant_id
        TenantService.create_owner_tenant_if_not_exist(account=account,name=tenant_name,is_setup=True)
        account.current_tenant.target_tenant_id = target_tenant_id
        db.session.commit()
        return account

    @staticmethod
    def get_admin_account() -> Account:
        admin = db.session.query(Account).filter(Account.target_tenant_id=="100").first()
        return admin

    @staticmethod
    def update_account_list(
        accounts: list[AccountInfo],
        target_tenant_id: str,
        interface_language: Optional[str] = None,
    ):
        db.session.begin_nested()
        """Register account"""
        try:
            # 获取对应的企业
            tenant = TenantExtService.get_tenant_by_target_tenant_id(target_tenant_id=target_tenant_id)
            if tenant is None:
                raise TenantNotFoundError("企业未初始，请联系管理员!")
            # 获取所有的用户列表
            exists = db.session.query(Account).filter(Account.target_tenant_id == target_tenant_id).all()
            #
            existDict = { account.email: account for account in exists }

            for account in accounts:
                email = account["email"]
                if email in existDict:
                    existAccount = existDict[email]
                    existAccount.name = account["name"]
                    existAccount.email = account["email"]
                    existAccount.user_id = account["user_id"]
                else:
                    newAccount = AccountService.create_account(email=account["email"],
                                                               name=account["name"],
                                                               interface_language=interface_language or languages[0],
                                                               password="wisdom@123",
                                                               is_setup=True)
                    newAccount.user_id = account["user_id"]
                    newAccount.target_tenant_id = target_tenant_id
                    # 创建企业关系
                    TenantService.create_tenant_member(tenant, newAccount)
                db.session.commit()
        except WorkSpaceNotAllowedCreateError:
            db.session.rollback()
        except AccountRegisterError as are:
            db.session.rollback()
            logging.exception("Register failed")
            raise are
        except Exception as e:
            db.session.rollback()
            logging.exception("Register failed")
            raise AccountRegisterError(f"Registration failed: {e}") from e


class TenantExtService:

    @staticmethod
    def get_tenant() -> Tenant:
        # 获取第一个企业，为默认企业
        tenant = db.session.query(Tenant).first()
        return tenant

    @staticmethod
    def get_tenant_by_target_tenant_id(target_tenant_id:str) -> Tenant:
        # 获取第一个企业，为默认企业
        tenant = db.session.query(Tenant).filter(Tenant.target_tenant_id == target_tenant_id).first()
        return tenant

    @staticmethod
    def setModeConfig(tenant_id:str, args:dict[str, object], provider:str) -> None:

        model_load_balancing_service = ModelLoadBalancingService()
        if (
            "load_balancing" in args
            and args["load_balancing"]
            and "enabled" in args["load_balancing"]
            and args["load_balancing"]["enabled"]
        ):
            if "configs" not in args["load_balancing"]:
                raise ValueError("invalid load balancing configs")

            # save load balancing configs
            model_load_balancing_service.update_load_balancing_configs(
                tenant_id=tenant_id,
                provider=provider,
                model=args["model"],
                model_type=args["model_type"],
                configs=args["load_balancing"]["configs"],
            )

            # enable load balancing
            model_load_balancing_service.enable_model_load_balancing(
                tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
            )
        else:
            # disable load balancing
            model_load_balancing_service.disable_model_load_balancing(
                tenant_id=tenant_id, provider=provider, model=args["model"], model_type=args["model_type"]
            )

            if args.get("config_from", "") != "predefined-model":
                model_provider_service = ModelProviderService()

                try:
                    model_provider_service.save_model_credentials(
                        tenant_id=tenant_id,
                        provider=provider,
                        model=args["model"],
                        model_type=args["model_type"],
                        credentials=args["credentials"],
                    )
                except CredentialsValidateFailedError as ex:
                    logging.exception(
                        f"Failed to save model credentials, tenant_id: {tenant_id},"
                        f" model: {args.get('model')}, model_type: {args.get('model_type')}"
                    )
                    raise ValueError(str(ex))

    @staticmethod
    def install_plugin(tenant_id:str):
        TenantExtService.install_langgenius(tenant_id=tenant_id)
        TenantExtService.install_model(tenant_id=tenant_id)

    @staticmethod
    def install_model(tenant_id:str):

        params = {
            "INIT_MODEL_LLM_NAME" : dify_config.INIT_MODEL_LLM_NAME,
            "INIT_MODEL_LLM_CONTEXT_SIZE" : dify_config.INIT_MODEL_LLM_CONTEXT_SIZE,
            "INIT_MODEL_LLM_MAX_TOKENS" : dify_config.INIT_MODEL_LLM_MAX_TOKENS,
            "INIT_MODEL_LLM_BASE_URL" : dify_config.INIT_MODEL_LLM_BASE_URL
        }
        llm_config = get_ext_config(file_name="plugin_llm_config.yml",params = params)

        TenantExtService.setModeConfig(
            tenant_id=tenant_id,args=llm_config,provider=dify_config.INIT_MODEL_LLM_PROVIDER
        )

        params = {
            "INIT_MODEL_TEXT_EMBEDDING_NAME" : dify_config.INIT_MODEL_TEXT_EMBEDDING_NAME,
            "INIT_MODEL_TEXT_EMBEDDING_CONTEXT_SIZE" : dify_config.INIT_MODEL_TEXT_EMBEDDING_CONTEXT_SIZE,
            "INIT_MODEL_TEXT_EMBEDDING_MAX_TOKENS" : dify_config.INIT_MODEL_TEXT_EMBEDDING_MAX_TOKENS,
            "INIT_MODEL_TEXT_EMBEDDING_BASE_URL" : dify_config.INIT_MODEL_TEXT_EMBEDDING_BASE_URL
        }
        text_embedding_config = get_ext_config(file_name="plugin_embedding_config.yml", params=params)
        TenantExtService.setModeConfig(
            tenant_id=tenant_id,args=text_embedding_config,provider=dify_config.INIT_MODEL_TEXT_EMBEDDING_PROVIDER
        )
        params = {
            "INIT_MODEL_TEXT_EMBEDDING_RERANK_NAME": dify_config.INIT_MODEL_TEXT_EMBEDDING_RERANK_NAME,
            "INIT_MODEL_TEXT_EMBEDDING_RERANK_BASE_URL": dify_config.INIT_MODEL_TEXT_EMBEDDING_RERANK_BASE_URL,
        }
        text_embedding_rerank_config = get_ext_config(file_name="plugin_embedding_rerank_config.yml", params=params)
        TenantExtService.setModeConfig(
            tenant_id=tenant_id,args=text_embedding_rerank_config,provider=dify_config.INIT_MODEL_TEXT_EMBEDDING_RERANK_PROVIDER
        )

    @staticmethod
    def install_langgenius(tenant_id: str):
        upload_unique_identifiers = TenantExtService.upload_langgenius(tenant_id=tenant_id)
        # plugin_unique_identifiers = dify_config.PLUGIN_UNIQUE_IDENTIFIERS.split(",") if dify_config.PLUGIN_UNIQUE_IDENTIFIERS else []
        # 查询已经安装的
        tasks = PluginService.list(tenant_id)
        # 已经安装的插件
        exists_plugin_unique_identifiers = [item.plugin_unique_identifier for item in tasks]
        # 去除已经安装的插件ID，只保留未安装的插件ID
        new_unique_identifiers = [uui for uui in upload_unique_identifiers if uui not in exists_plugin_unique_identifiers]
        # 安装插件
        PluginService.install_from_marketplace_pkg(tenant_id, new_unique_identifiers)

    @staticmethod
    def upload_langgenius(tenant_id: str) -> list[str]:
        directory = Path(__file__).parent.parent.parent / 'plugins' / 'langgenius'
        unique_identifiers = []
        for filename in os.listdir(directory):
            file_path = os.path.join(directory, filename)
            if os.path.isfile(file_path):
                print(f"读取文件：{file_path}")
                with open(file_path, 'rb') as f:
                    content = f.read()
                    try:
                        response = PluginService.upload_pkg(tenant_id=tenant_id, pkg=content)
                        unique_identifier = response.unique_identifier
                        unique_identifiers.append(unique_identifier)
                    except PluginDaemonClientSideError as e:
                        raise ValueError(e)
        return unique_identifiers

    @staticmethod
    def enable_tenant(
        target_tenant_id: str,
        target_tenant_name: str,
    ) -> TenantAccountInfo:
        db.session.begin_nested()
        password = "wisdom@123"
        try:
            email = f"admin@{target_tenant_id}.com"
            admin_name = f"{target_tenant_name}-管理员"
            # 判断企业是否已经创建
            tenant = TenantExtService.get_tenant_by_target_tenant_id(target_tenant_id)
            if tenant is not None:
                account = AccountService.get_user_through_email(email)
                if account is None:
                    account = AccountService.create_account(email=email, name=admin_name, password=password, is_setup=True,interface_language="zh-Hans")
                    TenantService.create_tenant_member(tenant, account, role="owner")
                    account.target_tenant_id = target_tenant_id
            else:
                account = AccountExtService.create_account_and_tenant(email=email,
                                                                      name=admin_name,
                                                                      tenant_name=target_tenant_name,
                                                                      target_tenant_id=target_tenant_id,
                                                                      interface_language="zh-Hans",
                                                                      password=password)
                # 获取第一个企业，为默认企业
                tenant = account.current_tenant

            account_info = TenantAccountInfo(tenant_name=tenant.name,
                                     tenant_id=tenant.id,
                                     admin_account=admin_name,
                                     admin_account_password=password)
            return account_info
        except Exception as e:
            db.session.rollback()
            logging.exception("Register failed")
            raise AccountRegisterError(f"Registration failed: {e}") from e

    @staticmethod
    def init_tenant(
        target_tenant_id: str,
        target_tenant_name: str,
    ) -> TenantData:
        db.session.begin_nested()
        try:
            account = flask_login.current_user
            tenant = account.current_tenant
            # 初始化大模型插槽
            TenantExtService.install_plugin(tenant_id=tenant.id)
            # 初始化知识库
            datasets = DatasetExtService.init_dataset(
                tenant=tenant, target_tenant_id=target_tenant_id,target_tenant_name=target_tenant_name,account=account
            )
            # 获取Api token
            api_token = DatasetExtService().get_or_add_datasets_api_token(tenant_id=tenant.id)
            db.session.commit()
            dataset_ids = [dataset.id for dataset in datasets]
            tenant_data = TenantData(api_key=api_token.token,
                                     dataset_ids=dataset_ids)
            return tenant_data
        except Exception as e:
            db.session.rollback()
            logging.exception("Register failed")
            raise AccountRegisterError(f"Registration failed: {e}") from e


