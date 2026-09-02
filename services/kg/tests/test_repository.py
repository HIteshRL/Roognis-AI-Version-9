from repository import MemoryGraphRepository
from schemas import GraphNodeInput, GraphRelationshipInput


def test_only_active_nodes_and_edges_enter_the_default_subgraph():
    repo = MemoryGraphRepository()
    repo.upsert_node(GraphNodeInput(nodeId="concept.fractions", kind="Concept", label="Fractions", status="active"))
    repo.upsert_node(GraphNodeInput(nodeId="concept.decimals", kind="Concept", label="Decimals", status="active"))
    repo.link(GraphRelationshipInput(
        fromNodeId="concept.fractions",
        toNodeId="concept.decimals",
        relationship="PREREQUISITE_OF",
        status="active",
    ))
    graph = repo.subgraph(["concept.fractions"])
    assert len(graph["nodes"]) == 2
    assert graph["edges"][0]["relationship"] == "PREREQUISITE_OF"


def test_proposed_relationships_are_not_measurement_graph_edges():
    repo = MemoryGraphRepository()
    repo.upsert_node(GraphNodeInput(nodeId="item.1", kind="AssessmentItem", label="Question 1", status="active"))
    repo.upsert_node(GraphNodeInput(nodeId="concept.1", kind="Concept", label="Concept", status="active"))
    repo.link(GraphRelationshipInput(fromNodeId="item.1", toNodeId="concept.1", relationship="MEASURES"))
    assert repo.subgraph(["concept.1"])["edges"] == []


def test_active_isolated_concept_is_distinct_from_unknown_concept():
    repo = MemoryGraphRepository()
    repo.upsert_node(GraphNodeInput(nodeId="concept.known", kind="Concept", label="Known", status="active"))
    assert [node["nodeId"] for node in repo.subgraph(["concept.known"])["nodes"]] == ["concept.known"]
    assert repo.subgraph(["concept.unknown"])["nodes"] == []


def test_active_subgraph_never_returns_an_edge_to_a_proposed_node():
    repo = MemoryGraphRepository()
    repo.upsert_node(GraphNodeInput(nodeId="concept.active", kind="Concept", label="Active", status="active"))
    repo.upsert_node(GraphNodeInput(nodeId="concept.proposed", kind="Concept", label="Proposed", status="proposed"))
    repo.link(GraphRelationshipInput(
        fromNodeId="concept.active",
        toNodeId="concept.proposed",
        relationship="SIBLING_OF",
        status="active",
    ))
    graph = repo.subgraph(["concept.active"])
    assert [node["nodeId"] for node in graph["nodes"]] == ["concept.active"]
    assert graph["edges"] == []
