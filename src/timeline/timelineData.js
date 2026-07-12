(() => {
  const root = globalThis.ClaudeTimeline = globalThis.ClaudeTimeline || {};

  const buildTimelineMarkers = (branch) => {
    const human = branch
      .map((message, branchOrder) => ({ message, branchOrder }))
      .filter(item => item.message.sender === 'human');
    return human.map(({ message, branchOrder }, index) => ({
      id: message.uuid,
      uuid: message.uuid,
      sender: message.sender,
      summary: message.text,
      order: index,
      // Claude's virtual list indexes every message row (human + assistant).
      // This is spatial metadata only; UUID remains the marker identity.
      branchOrder,
      branchLength: branch.length,
      // Space is owned by the DOM layer. Do not turn API order into an
      // artificial evenly-spaced timeline.
      n: null,
      top: null,
      hasMeasuredPosition: false,
      element: null,
      mounted: false,
      dotElement: null,
      starred: false
    }));
  };

  root.timelineData = { buildTimelineMarkers };
})();
