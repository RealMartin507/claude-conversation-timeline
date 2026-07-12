const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const context = { globalThis: {} };
vm.createContext(context);
for (const file of ['src/parser/messageTree.js', 'src/timeline/timelineData.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}

test('uses the current leaf parent chain and ignores sibling branches', () => {
  const payload = {
    uuid: 'conversation',
    current_leaf_message_uuid: 'a2',
    chat_messages: [
      { uuid: 'u1', sender: 'human', content: 'first', parent_message_uuid: null },
      { uuid: 'a1', sender: 'assistant', content: 'answer', parent_message_uuid: 'u1' },
      { uuid: 'u2', sender: 'human', content: [{ text: 'current question' }], parent_message_uuid: 'a1' },
      { uuid: 'a2', sender: 'assistant', content: 'current answer', parent_message_uuid: 'u2' },
      { uuid: 'u-branch', sender: 'human', content: 'other branch', parent_message_uuid: 'a1' }
    ]
  };
  const conversation = context.globalThis.ClaudeTimeline.parser.normalizeConversation(payload);
  const branch = context.globalThis.ClaudeTimeline.parser.buildCurrentBranch(conversation.messages, conversation.currentLeafUuid);
  const markers = context.globalThis.ClaudeTimeline.timelineData.buildTimelineMarkers(branch);
  assert.deepEqual(Array.from(markers, marker => marker.uuid), ['u1', 'u2']);
  assert.equal(markers[1].summary, 'current question');
  assert.equal(markers[1].id, 'u2');
});

test('keeps API ordering as a safe fallback when no current leaf is supplied', () => {
  const conversation = context.globalThis.ClaudeTimeline.parser.normalizeConversation({
    chat_messages: [
      { uuid: 'u1', sender: 'human', content: 'one' },
      { uuid: 'u2', sender: 'human', content: 'two' }
    ]
  });
  const branch = context.globalThis.ClaudeTimeline.parser.buildCurrentBranch(conversation.messages, conversation.currentLeafUuid);
  assert.deepEqual(Array.from(branch, message => message.uuid), ['u1', 'u2']);
});

test('preserves diagnostic identity fields and drops messages without a uuid', () => {
  const conversation = context.globalThis.ClaudeTimeline.parser.normalizeConversation({
    chat_messages: [
      { uuid: 'u1', sender: 'human', content: 'one', parent_message_uuid: 'root' },
      { sender: 'assistant', content: 'missing identity' }
    ]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(conversation.messages)), [{
    uuid: 'u1', sender: 'human', parentUuid: 'root', text: 'one', order: 0
  }]);
});

test('uses the message uuid as marker identity and leaves DOM position unknown', () => {
  const markers = context.globalThis.ClaudeTimeline.timelineData.buildTimelineMarkers([
    { uuid: 'u1', sender: 'human', text: 'one' },
    { uuid: 'a1', sender: 'assistant', text: 'answer' }
  ]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].id, 'u1');
  assert.equal(markers[0].uuid, 'u1');
  assert.equal(markers[0].sender, 'human');
  assert.equal(markers[0].branchOrder, 0);
  assert.equal(markers[0].branchLength, 2);
  assert.equal(markers[0].element, null);
  assert.equal(markers[0].n, null);
});
