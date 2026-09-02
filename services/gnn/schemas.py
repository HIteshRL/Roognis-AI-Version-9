from pydantic import BaseModel, ConfigDict, Field


class PreferenceTopic(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    topic_id: str = Field(alias="topicId", min_length=1, max_length=160)
    features: list[float] = Field(min_length=1, max_length=64)
    baseline_score: float = Field(default=0, alias="baselineScore", ge=-1, le=1)


class PreferenceInteraction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    topic_id: str = Field(alias="topicId", min_length=1, max_length=160)
    stance: str = Field(pattern="^(LIKE|DISLIKE)$")
    weight: float = Field(default=1, gt=0, le=10)


class GraphEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    from_id: str = Field(alias="fromId")
    to_id: str = Field(alias="toId")


class PreferenceScoreRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    student_id: str = Field(alias="studentId")
    topics: list[PreferenceTopic] = Field(min_length=1, max_length=1000)
    interactions: list[PreferenceInteraction] = Field(default_factory=list, max_length=5000)
    edges: list[GraphEdge] = Field(default_factory=list, max_length=10000)


class KnowledgeConcept(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    concept_id: str = Field(alias="conceptId")
    features: list[float] = Field(min_length=1, max_length=64)
    baseline_mastery: float = Field(default=0.25, alias="baselineMastery", ge=0, le=1)


class KnowledgeEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    concept_id: str = Field(alias="conceptId")
    outcome: float = Field(ge=0, le=1)
    weight: float = Field(gt=0, le=2)
    difficulty: float = Field(default=0.5, ge=0, le=1)


class KnowledgeScoreRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    student_id: str = Field(alias="studentId")
    concepts: list[KnowledgeConcept] = Field(min_length=1, max_length=1000)
    events: list[KnowledgeEvent] = Field(default_factory=list, max_length=10000)
    edges: list[GraphEdge] = Field(default_factory=list, max_length=10000)
