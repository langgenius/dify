from datetime import datetime, timedelta
from models.account import PlanType, BasePlan, TenantPlan, Tenant  , PlanInterval
from extensions.ext_database import db

# TODO we will use the webhook to create transactions and update the tenant plan 
# TODO we have to insert account in the worker once they are created , so that we can expire them time has reached
class TenantPlanService:
    @classmethod
    def get_tenant_plan(cls, tenant_id: str) -> TenantPlan:
        # Get the current active tenant plan
        
        current_plan = TenantPlan.query.filter_by(tenant_id=tenant_id, is_active=True).order_by(TenantPlan.end_date.desc()).first()
        print('current plan')
        print(current_plan)
        
        if current_plan:
            return current_plan
        

        sandbox_base_plan = BasePlan.query.filter_by(plan_type=PlanType.SANDBOX.value).first()
        print('sandbox base plan')  
        print(sandbox_base_plan)

        if not sandbox_base_plan:
            raise ValueError("Sandbox base plan not found in the database")
        

        new_plan = cls.create_tenant_plan(tenant_id, PlanType.SANDBOX , "monthly")
        return new_plan

    @classmethod
    def update_tenant_plan(cls, tenant_id: str, plan_type: str, interval: str , multiplier: float = 1.0) -> TenantPlan:
        current_plan = cls.get_tenant_plan(tenant_id)
        new_base_plan = BasePlan.query.filter_by(plan_type=plan_type).first()
        
        if not new_base_plan:
            raise ValueError(f"Base plan of type {plan_type} not found")
        
        if current_plan.base_plan_id == new_base_plan.id:
            return current_plan  # No change needed
        
        if current_plan.base_plan.plan_type == "SANDBOX":
            # If current plan is sandbox, update it immediately
            current_plan.is_active = False
            db.session.add(current_plan)
            new_plan = cls.create_tenant_plan(tenant_id, plan_type, interval , multiplier)
        else:
            # New plan will start when the current plan ends
            new_plan = TenantPlan(
                tenant_id=tenant_id,
                base_plan_id=new_base_plan.id,
                start_date=current_plan.end_date,
                end_date=cls._calculate_end_date(current_plan.end_date, interval),
                is_active=False , 
                interval =  PlanInterval.MONTHLY if interval == "monthly"  else PlanInterval.YEARLY ,
                amount =  new_base_plan.price_monthly * multiplier  if interval == "monthly"  else new_base_plan.price_yearly * multiplier
            )
            db.session.add(new_plan)
        
        db.session.commit()
        return new_plan

    @classmethod
    def create_tenant_plan(cls, tenant_id: str, plan_type: str, interval: str, multiplier: float = 1.0) -> TenantPlan:
        base_plan = BasePlan.query.filter_by(plan_type=plan_type).first()
        if not base_plan:
            raise ValueError(f"Base plan of type {plan_type} not found")
        
        start_date = datetime.utcnow()
        end_date = cls._calculate_end_date(start_date, interval)
        
        new_plan = TenantPlan(
            tenant_id=tenant_id,
            base_plan_id=base_plan.id,
            start_date=start_date,
            end_date=end_date,
            is_active=True , 
            multiplier=multiplier  , 
            interval =  PlanInterval.MONTHLY if interval == "monthly"  else PlanInterval.YEARLY , 
            amount =  base_plan.price_monthly * multiplier  if interval == "monthly"  else base_plan.price_yearly * multiplier
        )
        
        db.session.add(new_plan)
        db.session.commit()
        return new_plan

    @staticmethod
    def _calculate_end_date(start_date, interval):
        if interval == "monthly":
            return start_date + timedelta(days=30)
        elif interval == "yearly":
            return start_date + timedelta(days=365)
        else:
            raise ValueError("Invalid interval. Must be 'monthly' or 'yearly'")

            
    @staticmethod
    def get_base_plan(plan_id : str) -> BasePlan :
       
       base_plan = BasePlan.query.filter_by(id=plan_id).first() 

       if not base_plan:
           raise ValueError(f"Base plan {plan_id} not found")

       return base_plan