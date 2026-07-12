(() => {
  const root = globalThis.ClaudeTimeline = globalThis.ClaudeTimeline || {};
  const UUID_ATTRIBUTE = 'data-claude-timeline-message-uuid';
  const LOCATE_EVENT = 'claude-timeline:locate-uuids';
  const RESULT_EVENT = 'claude-timeline:locate-result';
  let lastScan = { requested: 0, fiberScanned: 0, found: 0 };

  document.addEventListener(RESULT_EVENT, event => {
    if (event.detail && typeof event.detail === 'object') lastScan = { ...event.detail };
  });

  const refreshDomMap = (domMap, uuids) => {
    const wanted = Array.from(uuids || []).filter(Boolean);
    if (!wanted.length) return domMap;
    document.dispatchEvent(new CustomEvent(LOCATE_EVENT, { detail: { uuids: wanted } }));
    const wantedSet = new Set(wanted);
    for (const element of document.querySelectorAll(`[${UUID_ATTRIBUTE}]`)) {
      const uuid = element.getAttribute(UUID_ATTRIBUTE);
      if (uuid && wantedSet.has(uuid)) domMap.set(uuid, element);
    }
    for (const [uuid, element] of domMap) {
      if (!element?.isConnected) domMap.delete(uuid);
    }
    return domMap;
  };

  const findMessageElement = (uuid, domMap) => {
    const known = domMap.get(uuid);
    if (known?.isConnected) return known;
    refreshDomMap(domMap, [uuid]);
    return domMap.get(uuid)?.isConnected ? domMap.get(uuid) : null;
  };

  const getLastScanStats = () => ({ ...lastScan });

  root.locator = { UUID_ATTRIBUTE, LOCATE_EVENT, refreshDomMap, findMessageElement, getLastScanStats };
})();
