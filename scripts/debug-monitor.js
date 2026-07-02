/**
 * Claude Conversation Timeline 诊断脚本
 *
 * 用法：
 * 1. 打开一个 Claude 历史对话页面，确保插件已加载。
 * 2. 打开 DevTools -> Console，粘贴本文件全部内容并回车运行。
 * 3. 正常操作（滚动、点击点点等），脚本会在数量/状态变化时自动打印日志。
 * 4. 复现问题后，在 Console 执行 `__ctlDump()`，会打印一段 JSON 文本，
 *    把它整段复制发给我。也可以执行 `__ctlStop()` 停止监控。
 */
(() => {
  const TAG = '[TL-DEBUG]';
  const POLL_MS = 500;
  const MAX_EVENTS = 2000;

  if (window.__ctlMonitor) {
    console.warn(TAG, '监控已在运行，先执行 __ctlStop() 再重新运行本脚本');
    return;
  }

  const events = [];
  const pushEvent = (type, data) => {
    const entry = { t: Date.now(), type, data };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.shift();
    return entry;
  };

  const getInstance = () => window.__claudeTimelineDebug || null;

  const snapshotInstance = () => {
    const inst = getInstance();
    if (!inst) return null;
    const markers = Array.isArray(inst.markers) ? inst.markers : [];
    const mounted = markers.filter(m => m.mounted).length;
    const starred = markers.filter(m => m.starred).length;
    const nRange = markers.length
      ? [Math.min(...markers.map(m => m.n)), Math.max(...markers.map(m => m.n))]
      : null;
    // 检查 id 重复（合并逻辑若有 bug 会在这里体现）
    const idCounts = new Map();
    for (const m of markers) idCounts.set(m.id, (idCounts.get(m.id) || 0) + 1);
    const dupIds = [...idCounts.entries()].filter(([, c]) => c > 1).map(([id]) => id);
    return {
      conversationId: inst.conversationId,
      markersTotal: markers.length,
      markersMounted: mounted,
      markersUnmounted: markers.length - mounted,
      starredCount: starred,
      activeTurnId: inst.activeTurnId,
      fisheyeMode: inst.fisheyeMode,
      focusStart: inst.focusStart,
      focusEnd: inst.focusEnd,
      nRange,
      duplicateIds: dupIds,
      hashToIdsSize: inst.hashToIds ? inst.hashToIds.size : null,
    };
  };

  const snapshotDom = () => {
    const domMsgCount = document.querySelectorAll('div[data-testid="user-message"]').length;
    const dotEls = document.querySelectorAll('.claude-timeline-dot');
    // 单条消息点用 targetTurnId；鱼眼聚合桶点用 bucketIndex（没有单一 targetTurnId，不计入重复检测）
    const dotIds = [...dotEls].map(d => d.dataset.targetTurnId || null).filter(Boolean);
    // 注：鱼眼聚合桶点没有 targetTurnId，正常情况下不会出现在 dotIds 里，
    // 因此这里检测到的重复必然发生在"非聚合展示的单条消息点"之间，属于合并逻辑 bug 的信号
    const dupDotIds = (() => {
      const c = new Map();
      for (const id of dotIds) c.set(id, (c.get(id) || 0) + 1);
      return [...c.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    })();
    return {
      domMessageCount: domMsgCount,
      renderedDotCount: dotEls.length,
      duplicateDotIds: dupDotIds,
      scrollY: window.scrollY,
    };
  };

  let lastSnapshot = null;

  const diffAndLog = (reason) => {
    const inst = snapshotInstance();
    const dom = snapshotDom();
    const combined = { reason, inst, dom };
    const key = JSON.stringify({
      markersTotal: inst?.markersTotal,
      markersMounted: inst?.markersMounted,
      renderedDotCount: dom.renderedDotCount,
      domMessageCount: dom.domMessageCount,
      activeTurnId: inst?.activeTurnId,
    });
    if (key === lastSnapshot) return; // 无变化，不打印
    lastSnapshot = key;
    pushEvent('snapshot', combined);
    console.log(
      `${TAG} [${reason}] markers=${inst?.markersTotal ?? 'N/A'}(mounted=${inst?.markersMounted ?? 'N/A'}) dots=${dom.renderedDotCount} domMsgs=${dom.domMessageCount} active=${inst?.activeTurnId ?? '-'} scrollY=${dom.scrollY}` +
      (inst?.duplicateIds?.length ? ` ⚠️重复id=${JSON.stringify(inst.duplicateIds)}` : '') +
      (dom.duplicateDotIds?.length ? ` ⚠️重复dot=${JSON.stringify(dom.duplicateDotIds)}` : '')
    );
  };

  // 定时轮询
  const pollTimer = setInterval(() => diffAndLog('poll'), POLL_MS);

  // 滚动事件（节流）
  let scrollRaf = null;
  const onScroll = () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      diffAndLog('scroll');
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });

  // 点击时间轴点点
  const onClick = (e) => {
    const dot = e.target.closest && e.target.closest('.claude-timeline-dot');
    if (!dot) return;
    pushEvent('click-dot', {
      targetTurnId: dot.dataset.targetTurnId || null,
      bucketIndex: dot.dataset.bucketIndex || null,
      rect: dot.getBoundingClientRect(),
    });
    console.log(`${TAG} [click-dot] targetTurnId=${dot.dataset.targetTurnId || '-'} bucketIndex=${dot.dataset.bucketIndex || '-'}`);
    // 点击后连续追踪几帧，观察是否跳到正确位置
    let n = 0;
    const track = () => {
      diffAndLog('click-followup-' + n);
      n++;
      if (n < 10) requestAnimationFrame(track);
    };
    requestAnimationFrame(track);
  };
  document.addEventListener('click', onClick, true);

  // MutationObserver 监控消息节点增删频率
  const container = document.querySelector('main') || document.body;
  const mo = new MutationObserver((mutations) => {
    let added = 0, removed = 0;
    for (const m of mutations) {
      added += m.addedNodes.length;
      removed += m.removedNodes.length;
    }
    if (added || removed) {
      pushEvent('mutation', { added, removed });
      diffAndLog('mutation');
    }
  });
  mo.observe(container, { childList: true, subtree: true });

  // 捕获插件相关的 console.log/warn，一并收进事件流（不影响原始输出）
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = function (...args) {
    if (typeof args[0] === 'string' && args[0].startsWith('[Timeline]')) {
      pushEvent('console.log', args.map(String).join(' '));
    }
    return origLog.apply(console, args);
  };
  console.warn = function (...args) {
    if (typeof args[0] === 'string' && args[0].startsWith('[Timeline]')) {
      pushEvent('console.warn', args.map(String).join(' '));
    }
    return origWarn.apply(console, args);
  };

  window.__ctlMonitor = { pollTimer, mo, onScroll, onClick, origLog, origWarn };

  window.__ctlDump = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      url: location.href,
      currentSnapshot: { inst: snapshotInstance(), dom: snapshotDom() },
      events,
    };
    const json = JSON.stringify(data, null, 2);
    console.log(TAG, `======== DUMP START (共 ${events.length} 条事件) ========`);
    console.log(json);
    console.log(TAG, '======== DUMP END ========');
    try {
      copy(json); // Chrome DevTools 内置的 copy() 辅助函数，直接写入剪贴板
      console.log(TAG, '已尝试自动复制到剪贴板（若失败请手动选中上面的 JSON 复制）');
    } catch (e) {
      console.log(TAG, '自动复制失败，请手动复制上面的 JSON', e);
    }
    return data;
  };

  window.__ctlStop = () => {
    clearInterval(pollTimer);
    mo.disconnect();
    window.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('click', onClick, true);
    console.log = origLog;
    console.warn = origWarn;
    delete window.__ctlMonitor;
    console.log(TAG, '监控已停止');
  };

  console.log(TAG, '监控已启动。滚动/点击时会自动打印状态变化。');
  console.log(TAG, '复现问题后执行 __ctlDump() 导出完整日志（会自动复制到剪贴板）；执行 __ctlStop() 停止监控。');
  diffAndLog('init');
})();
