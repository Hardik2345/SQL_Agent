# SQL Agent System Context

## Purpose

This service converts natural language analytics questions into validated SQL and executes them safely against tenant-specific MySQL databases.

This is a controlled analytics system, not a free-form autonomous agent.

---

## Architecture Boundary

This service lives inside the analytics domain.

It depends on an external `tenant-router` service for all tenant runtime routing.

`tenant-router` is the control-plane service for resolving `brand_id` to tenant database metadata.

This service must never bypass `tenant-router`.

---

## Tenant Isolation Rules

- Each brand has its own logical MySQL database.
- All brand-scoped requests must resolve tenant route metadata before any DB access.
- No cross-tenant queries are allowed.
- No cross-database references are allowed in generated SQL.
- The LLM must never see or infer credentials.

---

## Current Phase Scope

Phase 1 includes only:
- SQL Validation Layer
- Tenant-aware Execution Layer
- Contracts and runtime validators
- LangGraph orchestration skeleton
- POST /insights/query API

Not included yet:
- semantic layer
- correction loop
- insight generation
- caching
- hybrid local/API routing policies

---

## Non-Negotiable Execution Rule

The only valid flow is:

LLM or planner output
→ SQL draft
→ validation
→ execution

Validation must never be skipped.

---

## Tenant Router Boundary

The tenant-router service is responsible for:
- resolving `brand_id` to tenant routing metadata
- returning active tenant metadata needed for DB connectivity
- caching active tenant metadata
- failing explicitly for unknown or inactive tenants

The tenant-router service is NOT responsible for:
- executing analytics queries
- managing DB pool lifecycle
- generating SQL
- validating user authorization policy inside this service

This service must normalize tenant-router responses into an internal tenant execution context.

---

## Validation Layer Rules

The validation layer is the most critical module in Phase 1.

It must:
- parse SQL structurally
- allow only a single SELECT statement
- block DDL and DML
- block cross-database access
- validate allowed tables
- perform basic GROUP BY checks
- return structured error codes

The validation layer is deterministic and must not depend on the LLM.

---

## Execution Layer Rules

The execution layer must:
- use tenant-scoped MySQL pooling
- use the resolved tenant execution context
- enforce timeout
- enforce max row limit
- return structured execution results
- never create its own routing logic

---

## Orchestrator Rules

The orchestrator controls flow only.

It must:
- manage state across nodes
- call validation before execution
- avoid infinite retries
- remain deterministic in Phase 1

Minimal Phase 1 graph:
START -> plan -> generate_sql -> validate -> execute -> END

Planner and SQL generation may be mocked initially.

---

## Contract Discipline

Because this project uses JavaScript, contract clarity must be enforced with:
- JSDoc typedefs
- runtime validation helpers
- normalized DTOs between modules

Shared contracts should include:
- QueryRequest
- QueryPlan
- SqlDraft
- ValidationResult
- ExecutionResult
- AgentState
- TenantExecutionContext

---

## Logging & Observability

The system must log:
- tenant resolution attempts and outcomes
- generated SQL
- validation errors
- execution duration
- request correlation IDs

Do not log credentials.

---

## Safety Summary

This system prioritizes:
- tenant isolation
- deterministic safety
- controlled SQL execution
- explicit contracts
- observability

This system does not trust model output directly.