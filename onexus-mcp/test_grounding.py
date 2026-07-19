import unittest

from grounding import grounded_path


def edge(edge_id, source, target, truth, review="reviewed", deleted=False, evidence=None):
    return {"data": {
        "id": edge_id, "source": source, "target": target, "type": "affects", "dimension": "Decision",
        "relationship": {
            "truthClass": truth,
            "source": {"system": "OneRoot", "recordId": edge_id},
            "provenance": {"method": "test", "evidenceIds": evidence or []},
            "confidence": "Explicit", "validity": {"status": "active"},
            "review": {"status": review}, "lifecycle": {"deleted": deleted},
        },
    }}


class GroundedPathTests(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "nodes": [{"data": {"id": node, "displayLabel": node, "category": "Decision"}} for node in "ABCD"],
            "edges": [
                edge("governed", "A", "B", "governed", evidence=["EV-1"]),
                edge("decision", "B", "C", "decision-created", evidence=["EV-2"]),
                edge("rejected-shortcut", "A", "C", "inferred", review="rejected"),
                edge("deleted", "C", "D", "historical", deleted=True),
            ],
        }

    def test_returns_inspectable_path_and_evidence(self):
        result = grounded_path(self.graph, "A", "C")
        self.assertTrue(result["found"])
        self.assertEqual([edge["id"] for edge in result["edges"]], ["governed", "decision"])
        self.assertEqual(result["evidence_ids"], ["EV-1", "EV-2"])
        self.assertTrue(result["grounding"]["inspectable"])
        self.assertEqual(result["grounding"]["excluded_edges"]["rejected"], 1)

    def test_truth_filter_and_deleted_edges_can_block_a_path(self):
        filtered = grounded_path(self.graph, "A", "C", ["governed"])
        self.assertFalse(filtered["found"])
        deleted = grounded_path(self.graph, "A", "D", include_rejected=True)
        self.assertFalse(deleted["found"])
        self.assertEqual(deleted["excluded_edges"]["deleted"], 1)


if __name__ == "__main__":
    unittest.main()
