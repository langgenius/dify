from services.enterprise.base import EnterpriseRequest


class EnterpriseService:

    @classmethod
    def get_info(cls):
        return EnterpriseRequest.send_request('GET', '/info')
