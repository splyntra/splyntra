-- Additive migration for existing volumes: widen the span type enum to cover
-- RAG/data operations so retrieval, database, and vector-search calls are
-- first-class (not lumped into tool_call/step). Adding enum values while keeping
-- existing ids is a metadata-only change. Fresh installs get this from 001_init.sql.
ALTER TABLE splyntra.spans
    MODIFY COLUMN type Enum8('agent' = 1, 'llm_call' = 2, 'tool_call' = 3, 'step' = 4, 'retrieval' = 5, 'db' = 6, 'vector_search' = 7);
