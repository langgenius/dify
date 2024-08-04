import os 
from models.dataset import  Document
from models.model import App, MessageAnnotation
from services.tenant_plan_service import TenantPlanService
from extensions.ext_database import db
from models.account import Account, BasePlan, Tenant, TenantAccountJoin, TenantAccountRole, TenantPlan , PlanType , PlanInterval
from services.stripe_service import StripeService



# TODO: the moment a teant account is subscripted to a plan , we have to put tenant subscrtiption to the query as set the delay as the expirray date of the plan 
# if the plan is canceled , we have to remove the subscription from the query
class BillingService:


    @classmethod
    def get_info(cls, tenant_id: str):

          tenant_plan = TenantPlanService.get_tenant_plan(tenant_id) 

          base_plan = TenantPlanService.get_base_plan(tenant_plan.base_plan_id)
 
          return cls.format_plan_to_feature_model(tenant_plan, base_plan)




# TODO: we will another attribute , multiplier to hte plan , to make the plan custom
    @classmethod
    def get_subscription(cls, plan: str,
                         interval: str,
                         prefilled_email: str = '',
                         tenant_id: str = ''):


        

        price_id = BillingService.get_plan_price_id(plan, interval)
        print(f"price_id : {price_id}")


        account = db.session.query(Account).filter_by(email=prefilled_email).first()

        if not account:
            raise ValueError("Account does not exist")
         
        
        
        tenant = db.session.query(Tenant).filter_by(id=account.current_tenant_id).first() 

        customer_id = tenant.stripe_customer_id

        if not customer_id or customer_id == "":
           customer = StripeService.create_customer(account.email , account.name)
           customer_id = customer["id"]



        if not customer_id:
            raise ValueError("Customer does not exist")

        
        tenant.stripe_customer_id = customer_id
        db.session.add(tenant)
        db.session.commit()

        checkout_session = StripeService.create_checkout_session( customer_id ,
                                                                  price_id ,
                                                                  "http://localhost:3000/apps" ,
                                                                  "http://localhost:3000/apps" ,
                                                                  tenant_id)

        if not checkout_session:
            raise ValueError("Checkout session does not exist")



        return  {
         "url"  : checkout_session["url"]
        }


    @classmethod
    def get_model_provider_payment_link(cls,
                                        provider_name: str,
                                        tenant_id: str,
                                        account_id: str,
                                        prefilled_email: str):

                                        
        return "https://www.example.com"



    @classmethod
    def get_invoices(cls, prefilled_email: str = '', tenant_id: str = ''):

      #TODO we have to ingreate email service here to send email
       print(f"input : get_invoices funcation prefilled_email : {prefilled_email} tenant_id : {tenant_id}")

       plan =  StripeService.create_plan_with_price( PlanType.PROFESSIONAL , 2)

       
       print(f"plan : {plan}")

       return "https://www.example.com"
        




    @staticmethod
    def is_tenant_owner_or_admin(current_user):
        tenant_id = current_user.current_tenant_id

        join = db.session.query(TenantAccountJoin).filter(
            TenantAccountJoin.tenant_id == tenant_id,
            TenantAccountJoin.account_id == current_user.id
        ).first()

        if not TenantAccountRole.is_privileged_role(join.role):
            raise ValueError('Only team owner or team admin can perform this action')


    
    @staticmethod
    def format_plan_to_feature_model(  tenant_plan: TenantPlan, base_plan: BasePlan) :  

        max_members =  base_plan.team_members 
        max_apps =  base_plan.build_apps
        max_vector_space = base_plan.vector_storage
        max_annotation_quota_limit =  base_plan.annotation_quota_limit
        max_documents_upload_quota =  base_plan.documents_upload_quota
        docs_processing =  base_plan.document_processing_priority
        can_replace_logo = base_plan.custom_branding
        model_load_balancing_enabled = base_plan.model_load_balancing_enabled
        dataset_operator_enabled = base_plan.dataset_operator_enabled
        billing = {
            "enabled" : True , 
            "subscription" : {
                'plan' : base_plan.plan_type , 
                'interval' : tenant_plan.interval,
            }
        }

        
        cur_members = db.session.query(Account).filter(Account.id == TenantAccountJoin.account_id, TenantAccountJoin.tenant_id == tenant_plan.tenant_id  ).count()
        cur_apps = db.session.query(App).filter(App.tenant_id==tenant_plan.tenant_id).count()
        cur_documents = db.session.query(Document).filter(Document.tenant_id==tenant_plan.tenant_id).count()
        cur_annotations = BillingService.get_curr_annotation_quota(tenant_plan.tenant_id)
        cur_vector_space = BillingService.get_vector_space_quota(tenant_plan.tenant_id)

        print("----------------------------")
        print("cur members")
        print(cur_members)
        print("cur apps")
        print(cur_apps)
        print("cur documents")
        print(cur_documents)
        print("cur annotations")
        print(cur_annotations)
        print("cur vector space")
        print(cur_vector_space) 
        print("----------------------------")






        return {
           "members" : {
               "size" : int(cur_members) ,
               "limit": int(max_members)
                },
           "apps" : {
               "size" :  int(cur_apps) ,
               "limit" : int(max_apps)
                },
           "vector_space" : {
               "size" :  int(cur_vector_space) ,
               "limit" : int(max_vector_space)
                },
           "documents_upload_quota" : {
               "size" :  int(cur_documents) ,
               "limit" : int(max_documents_upload_quota)
                },
           "annotation_quota_limit" : {
               "size" :  int(cur_annotations) ,
               "limit" : int(max_annotation_quota_limit)
                },
           "docs_processing" : docs_processing,
           "can_replace_logo" : can_replace_logo,
           "model_load_balancing_enabled" : model_load_balancing_enabled,
           "dataset_operator_enabled" : dataset_operator_enabled,
           "billing" : billing
       }

     


    @staticmethod
    def get_curr_annotation_quota(tenant_id: str):

        apps = db.session.query(App).filter(App.tenant_id == tenant_id).all()

        annotation_quota = 0
        for app in apps:
            annotation_quota += db.session.query(MessageAnnotation).filter(MessageAnnotation.app_id == app.id).count()
 

 
        return annotation_quota

        
        
    @staticmethod
    def get_vector_space_quota( tenant_id: str):

        documents = db.session.query(Document).filter(Document.tenant_id == tenant_id, Document.indexing_status == 'completed').all()

        total_words_count = 0 

        for document in documents:
            total_words_count += document.word_count



        # each words has typicaly 5 tokens
        # 1.2 million token will give us 1 MB of vector space
        return float(f"{((total_words_count * 5  ) / ( 1.2 * 10**6 ) ):.2f}")



    @staticmethod
    def get_plan_price_id(plan: str, duration: str) -> str:

        
       plan = db.session.query(BasePlan).filter_by(plan_type=plan).first()
       print(f"plan : {plan}")

       return plan.price_id_monthly if duration == "month" else plan.price_id_yearly

        
        
    
