(() => {
  const root = globalThis.ClaudeTimeline = globalThis.ClaudeTimeline || {};

  const readText = (content) => {
    if (typeof content === 'string') return content.trim();
    if (!Array.isArray(content)) return '';
    return content.map(block => {
      if (typeof block === 'string') return block;
      if (!block || typeof block !== 'object') return '';
      return typeof block.text === 'string' ? block.text : '';
    }).filter(Boolean).join('\n').trim();
  };

  const normalizeConversation = (payload) => {
    if (!payload || !Array.isArray(payload.chat_messages)) {
      throw new Error('Claude conversation payload does not contain chat_messages');
    }
    const messages = payload.chat_messages.map((message, order) => ({
      uuid: String(message?.uuid || ''),
      sender: String(message?.sender || ''),
      parentUuid: message?.parent_message_uuid ? String(message.parent_message_uuid) : '',
      text: readText(message?.content),
      order
    })).filter(message => message.uuid);
    return {
      uuid: String(payload.uuid || ''),
      currentLeafUuid: String(payload.current_leaf_message_uuid || ''),
      messages
    };
  };

  const buildCurrentBranch = (messages, currentLeafUuid) => {
    const byUuid = new Map(messages.map(message => [message.uuid, message]));
    const branch = [];
    const visited = new Set();
    let cursor = byUuid.get(currentLeafUuid);
    while (cursor && !visited.has(cursor.uuid)) {
      visited.add(cursor.uuid);
      branch.push(cursor);
      cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : null;
    }
    if (branch.length === 0 && messages.length) {
      // Older responses may omit current_leaf_message_uuid. Preserve API order as
      // the least-surprising safe fallback instead of inventing a branch.
      return messages.slice();
    }
    return branch.reverse();
  };

  root.parser = { normalizeConversation, buildCurrentBranch };
})();
