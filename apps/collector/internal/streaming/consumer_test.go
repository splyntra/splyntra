// SPDX-License-Identifier: FSL-1.1-ALv2
package streaming

import "testing"

func TestRedeliveryDedup(t *testing.T) {
	c := &DetectionConsumer{processed: make(map[uint64]struct{}, maxProcessedKeys)}

	msgA := []byte(`{"trace_id":"t1","span_id":"s1","risk_score":80,"detections":[{"detector":"pii"}]}`)
	msgB := []byte(`{"trace_id":"t1","span_id":"s2","risk_score":10,"detections":[]}`)

	keyA := fnv64(msgA)
	if c.alreadyProcessed(keyA) {
		t.Fatal("fresh key should not be marked processed")
	}
	c.markProcessed(keyA)
	if !c.alreadyProcessed(keyA) {
		t.Fatal("redelivered identical message should be seen as processed")
	}
	// A different span's result must NOT be treated as a duplicate.
	if c.alreadyProcessed(fnv64(msgB)) {
		t.Fatal("distinct message must not collide with a processed key")
	}
}

func TestProcessedSetIsBounded(t *testing.T) {
	c := &DetectionConsumer{processed: make(map[uint64]struct{}, maxProcessedKeys)}
	for i := 0; i < maxProcessedKeys+10; i++ {
		c.markProcessed(uint64(i))
	}
	if len(c.processed) > maxProcessedKeys {
		t.Fatalf("processed set grew unbounded: %d", len(c.processed))
	}
}
