from extensions.ext_database import db
from models.api_based_extension import APIBasedExtension

class APIBasedExtensionService:

    @staticmethod
    def get_all_by_tenant_id(tenant_id: str):
        return db.session.query(APIBasedExtension) \
                    .filter_by(tenant_id=tenant_id) \
                    .order_by(APIBasedExtension.created_at.desc()) \
                    .all()

    @staticmethod
    def save(extension_data: APIBasedExtension) -> APIBasedExtension:
        # name
        if not extension_data.name:
            raise ValueError("name must not be empty")
        
        if not extension_data.id:
            # case one: check new data, name must be unique
            is_name_existed = db.session.query(APIBasedExtension) \
                .filter_by(tenant_id=extension_data.tenant_id) \
                .filter_by(name=extension_data.name) \
                .first()
            
            if is_name_existed:
                raise ValueError("name must be unique, it is already existed")
        else:
            # case two: check existing data, name must be unique
            is_name_existed = db.session.query(APIBasedExtension) \
                .filter_by(tenant_id=extension_data.tenant_id) \
                .filter_by(name=extension_data.name) \
                .filter(APIBasedExtension.id != extension_data.id) \
                .first()
            
            if is_name_existed:
                raise ValueError("name must be unique, it is already existed")

        # api_endpoint
        if not extension_data.api_endpoint:
            raise ValueError("api_endpoint must not be empty")
        
        # api_key
        if not extension_data.api_key:
            raise ValueError("api_key must not be empty")
        
        db.session.add(extension_data)
        db.session.commit()
        return extension_data
    
    @staticmethod
    def delete(extension_data: APIBasedExtension) -> None:
        db.session.delete(extension_data)
        db.session.commit()

    @staticmethod
    def get_with_tenant_id(tenant_id: str, api_based_extension_id: str) -> APIBasedExtension:
        api_based_extension = db.session.query(APIBasedExtension) \
            .filter_by(tenant_id=tenant_id) \
            .filter_by(id=api_based_extension_id) \
            .first()
        
        if not api_based_extension:
            raise ValueError("API based extension is not found")
        
        return api_based_extension