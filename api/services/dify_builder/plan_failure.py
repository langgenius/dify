"""Present failed Edit planning while preserving its accepted plan and gate."""

from dataclasses import fields, replace

from core.dify_builder.contract import FormCard
from core.dify_builder.models import DifyBuilderContext, Session
from core.dify_builder.progress import ProgressReporter
from core.dify_builder.state import PcState
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import BuilderText, copy_text
from services.dify_builder.application.handlers_fix import append_assistant, append_card, build_form_fields
from services.dify_builder.application.runner import Env, StepResult
from services.dify_builder.execution_messages import cognition_failure_message


def edit_planning_failed(
    env: Env,
    session: Session,
    context: DifyBuilderContext,
    progress: ProgressReporter,
    step_id: str,
    *,
    guidance: BuilderText | None = None,
) -> StepResult:
    """Keep the waiting state; reoffer submitted rules when that gate owns a form."""
    progress.fail_step(step_id)
    execution = progress.finish(status="error")
    form_items = []
    if session.current_state == PcState.EDIT_IMPACT_ANALYSIS:
        specs = {str(spec["key"]): spec for spec in context.form_fields if isinstance(spec, dict) and spec.get("key")}
        form_fields = [
            replace(
                form_field,
                **{
                    definition.name: specs[form_field.key][definition.name]
                    for definition in fields(form_field)
                    if definition.name not in {"key", "label", "type", "options", "hint"}
                    and definition.name in specs[form_field.key]
                },
            )
            for form_field in build_form_fields(context.form_fields)
        ]
        form_items = append_card(
            context,
            FormCard(
                variant="edit_rules",
                title=copy_text(BuilderCopyId.FORMS_EDIT_RULES_TITLE),
                description=copy_text(BuilderCopyId.FORMS_EDIT_RULES_DESCRIPTION),
                fields=form_fields,
                values=dict(context.edit_rules),
                frozen=False,
            ),
        )
    turn_items = append_assistant(
        env,
        session,
        context,
        guidance
        if guidance is not None
        else cognition_failure_message(
            env.diagnostics,
            copy_text(BuilderCopyId.REPLIES_BUILDER_COULDN_T_PRODUCE_A_USABLE),
            reply_language=context.reply_language,
        ),
        execution=execution,
        cards=["form"] if form_items else None,
        turn_id=progress.operation_id,
    )
    return StepResult(next=session.current_state, context=context, items=[*form_items, *turn_items])
