Node validation rules
- nodeType must exist in ontology
- category must belong to that nodeType
- id must be unique
- label.en recommended (required for most types)
- displayLabel never required (view-only)

Edge validation rules
- type must exist in ontology
- source.nodeType → target.nodeType must be allowed
- Direction must match ontology
- Extra attributes (phase, risk, metrics) are allowed but ignored by views

View validation rules (Chord)
- Node must:
    - be Topic
    - have a category listed in arcOrder
- Edge only needs valid source/target existence