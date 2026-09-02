from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


NodeKind = Literal["Concept", "Misconception", "AssessmentItem", "Taxonomy"]
RelationshipKind = Literal["PREREQUISITE_OF", "SIBLING_OF", "MEASURES", "DISTRACTOR_FOR", "IN_TAXONOMY"]


class GraphNodeInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    node_id: str = Field(alias="nodeId", min_length=2, max_length=160, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9._:-]+$")
    kind: NodeKind
    label: str = Field(min_length=1, max_length=240)
    status: Literal["proposed", "active", "retired"] = "proposed"
    board: str | None = Field(default=None, max_length=40)
    curriculum: str | None = Field(default=None, max_length=80)
    grade: int | None = Field(default=None, ge=1, le=12)
    subject: str | None = Field(default=None, max_length=80)
    chapter: str | None = Field(default=None, max_length=220)
    metadata: dict = Field(default_factory=dict)

    @field_validator("status")
    @classmethod
    def only_validated_nodes_become_active(cls, value: str) -> str:
        return value


class GraphRelationshipInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    from_node_id: str = Field(alias="fromNodeId", min_length=2, max_length=160)
    to_node_id: str = Field(alias="toNodeId", min_length=2, max_length=160)
    relationship: RelationshipKind
    status: Literal["proposed", "active"] = "proposed"
    evidence_ref: str | None = Field(default=None, alias="evidenceRef", max_length=240)


class SubgraphRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    node_ids: list[str] = Field(alias="nodeIds", min_length=1, max_length=500)
    active_only: bool = Field(default=True, alias="activeOnly")
