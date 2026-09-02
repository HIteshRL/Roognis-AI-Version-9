# Roognis Backend Service Workstreams

Last updated: 2026-08-30

Use this folder when multiple people are working in parallel. Each file is scoped to one backend service/workstream and can be shared with the person owning that part.

## Current Backend Reality

This index is a navigation aid, not a binding implementation plan. Verify service ownership and endpoint contracts against the current code before changing them.

| Workstream | Repo status | Needed for current dashboard story |
|---|---|---|
| Auth Service | Implemented for login/users/parent links | Identity and parent-link changes only |
| AI Service | Implemented for chat, image, video metadata, feedback, safety | Needs quiz-draft generation support |
| Quiz Service | Implemented | Chapter quiz generation, review, attempts |
| Analytics / Learning Progress | Implemented | Maintain current event/dashboard contracts |
| RAG / EKE Service | Implemented | Maintain ingestion/retrieval contracts |
| LMS / Classroom | Implemented | Classroom, enrollment, coursework, grading |
| Practice / Discover | Implemented | Student practice and discovery flows |
| Backend Infra | Docker/K8s exists for current services | Keep deployment manifests aligned with code |

## Recommended Work Order

Prioritise work by dependency, risk, and user value; do not treat the historical sequence below as a gate:

1. Freeze the contract needed by the feature.
2. Implement and test the owning service.
3. Verify cross-service auth, tenancy, and deployment behavior.

## Files

- `AI_SERVICE_LLD.md`
- `ANALYTICS_SERVICE_LLD.md`
- `RAG_SERVICE_LLD.md`
- `RAG_EKE_INGESTION_CONTRACT.md`

## Cross-Service Ownership Rules

- Auth owns identity, roles, and parent links; LMS owns classrooms and roster.
- AI owns model calls, child safety, tutor responses, image generation, and AI-generated quiz drafts.
- Quiz owns chapter quiz lifecycle, attempts, grading, and review; LMS owns classroom coursework and assignments.
- Analytics owns dashboard aggregation, streaks, time spent, weak-area rollups, and parent/teacher/student summaries.
- RAG / EKE owns lesson/document ingestion, educational entities, and retrieval context.
- Frontend should not infer permissions from hardcoded email strings once backend wiring begins.

