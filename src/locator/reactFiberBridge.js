// Runs in the page's MAIN world because React Fiber expandos are not reliably
// observable from an isolated content-script world.
(() => {
  const ATTRIBUTE = 'data-claude-timeline-message-uuid';
  const EVENT = 'claude-timeline:locate-uuids';
  const RESULT_EVENT = 'claude-timeline:locate-result';
  const getFiberMessageUuid = (element) => {
    let keys = [];
    try { keys = Object.getOwnPropertyNames(element); } catch { return null; }
    for (const key of keys) {
      if (!key.startsWith('__reactFiber$')) continue;
      try {
        // The host DOM node's Fiber generally does not own `message`; its
        // function-component parent does. Walk the Fiber return chain while
        // retaining this host node as the HTMLElement to scroll to.
        const pending = [element[key], element[key]?.alternate];
        const seen = new Set();
        while (pending.length) {
          const fiber = pending.pop();
          if (!fiber || seen.has(fiber)) continue;
          seen.add(fiber);
          // Only accept the message object owned by this component. Searching
          // recursively through parent state is unsafe: shared conversation
          // providers contain every UUID and can label all DOM rows alike.
          const uuid = fiber.memoizedProps?.message?.uuid || fiber.pendingProps?.message?.uuid;
          if (typeof uuid === 'string' && uuid) return uuid;
          if (fiber.return) pending.push(fiber.return);
          if (fiber.alternate) pending.push(fiber.alternate);
        }
      } catch { }
    }
    return null;
  };

  document.addEventListener(EVENT, event => {
    const uuids = Array.isArray(event.detail?.uuids) ? event.detail.uuids.filter(value => typeof value === 'string' && value) : [];
    if (!uuids.length) return;
    const wanted = new Set(uuids);
    let fiberScanned = 0;
    let found = 0;
    // User-message nodes are the scroll targets. Inspecting only these nodes
    // also prevents a UUID found on a shared ancestor from being assigned to
    // dozens of arbitrary descendants.
    const candidates = document.querySelectorAll('div[data-testid="user-message"]');
    for (const element of candidates) {
      fiberScanned += 1;
      const uuid = getFiberMessageUuid(element);
      if (uuid && wanted.has(uuid)) {
        element.setAttribute(ATTRIBUTE, uuid);
        found += 1;
      }
    }
    document.dispatchEvent(new CustomEvent(RESULT_EVENT, {
      detail: { requested: wanted.size, fiberScanned, found }
    }));
  }, false);
})();
