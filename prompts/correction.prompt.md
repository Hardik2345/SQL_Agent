# Correction Prompt (Phase 2 — placeholder)

> The correction loop is **not** part of Phase 1.
> This file exists so the prompt surface is stable when Phase 2 adds it.

## Planned inputs

- `plan`: the original `QueryPlan`.
- `previous_sql`: the SQL that failed validation.
- `validation_issues`: the structured `ValidationIssue[]` returned by the
  validator.
- `schema_context`: allowed tables and columns.

## Planned output

A new `SqlDraft` that resolves every `error`-severity issue. Warnings may
be left in place if addressing them would make the query incorrect.

## Planned hard rules

- Same rules as `sql.prompt.md`.
- Must address every `error`-severity validation issue explicitly.
- Must not reintroduce a previously rejected statement type.
- Never retry more than `MAX_CORRECTION_ATTEMPTS` times (policy enforced
  by the orchestrator, not the prompt).
