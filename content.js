(() => {
  const USER_MESSAGE_SELECTOR = 'div[data-testid="user-message"]';
  const TIMELINE_BAR_CLASS = 'claude-timeline-bar';
  const TIMELINE_DOT_CLASS = 'claude-timeline-dot';
  const TIMELINE_TOOLTIP_ID = 'claude-timeline-tooltip';

  class TimelineManager {
    constructor() {
      this.scrollContainer = null;
      this.conversationContainer = null;
      this.markers = [];
      this.activeTurnId = null;
      this.starred = new Set();
      this.markerMap = new Map();
      this.ui = { bar: null, track: null, tooltip: null };

      this.mutationObserver = null;
      this.resizeObserver = null;
      this.intersectionObserver = null;
      this.themeObserver = null;
      this.visibleUserTurns = new Set();
      this.activeSyncRaf = null;

      this.onScroll = null;
      this.onClick = null;
      this.onPointerDown = null;
      this.onPointerMove = null;
      this.onPointerUp = null;
      this.onPointerCancel = null;
      this.onMouseOver = null;
      this.onMouseOut = null;
      this.onFocusIn = null;
      this.onFocusOut = null;
      this.onWindowResize = null;
      this.onStorage = null;

      this.longPressDuration = 550;
      this.longPressMoveTolerance = 6;
      this.longPressTimer = null;
      this.pressStartPos = null;
      this.pressTargetDot = null;
      this.longPressTriggered = false;
      this.suppressClickUntil = 0;

      this.conversationId = this.extractConversationIdFromPath(location.pathname);
      this.visibleRange = { start: 0, end: -1 };
      this.yPositions = [];
      this.debouncedRecalculate = this.debounce(() => this.recalculateAndRenderMarkers(), 250);
    }

    async init() {
      const ok = await this.findCriticalElements();
      if (!ok) return;
      this.injectTimelineUI();
      this.setupEventListeners();
      this.setupObservers();
      this.conversationId = this.extractConversationIdFromPath(location.pathname);
      this.loadStars();
      this.recalculateAndRenderMarkers();
    }

    async findCriticalElements() {
      const firstMessage = await this.waitForElement(USER_MESSAGE_SELECTOR);
      if (!firstMessage) return false;
      const messages = Array.from(document.querySelectorAll(USER_MESSAGE_SELECTOR));
      this.conversationContainer = this.findCommonAncestor(messages) || document.body;
      this.scrollContainer = this.pickScrollContainer(messages) || document.scrollingElement || document.documentElement || document.body;
      return true;
    }

    injectTimelineUI() {
      let bar = document.querySelector(`.${TIMELINE_BAR_CLASS}`);
      if (!bar) {
        bar = document.createElement('div');
        bar.className = TIMELINE_BAR_CLASS;
        document.body.appendChild(bar);
      }
      this.ui.bar = bar;

      let track = bar.querySelector('.claude-timeline-track');
      if (!track) {
        track = document.createElement('div');
        track.className = 'claude-timeline-track';
        bar.appendChild(track);
      }
      this.ui.track = track;

      let tooltip = document.getElementById(TIMELINE_TOOLTIP_ID);
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = TIMELINE_TOOLTIP_ID;
        tooltip.className = 'claude-timeline-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        tooltip.setAttribute('aria-hidden', 'true');
        document.body.appendChild(tooltip);
      }
      this.ui.tooltip = tooltip;
    }

    setupObservers() {
      this.mutationObserver = new MutationObserver(() => {
        this.debouncedRecalculate();
      });
      this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

      this.resizeObserver = new ResizeObserver(() => {
        this.recalculateAndRenderMarkers();
      });
      if (this.ui.bar) this.resizeObserver.observe(this.ui.bar);

      try {
        this.themeObserver = new MutationObserver(() => {
          this.recalculateAndRenderMarkers();
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      } catch { }

      const isWindowScroll = this.scrollContainer === document.body || this.scrollContainer === document.documentElement || this.scrollContainer === document.scrollingElement;
      this.intersectionObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.visibleUserTurns.add(entry.target);
          } else {
            this.visibleUserTurns.delete(entry.target);
          }
        }
        this.scheduleActiveSync();
      }, {
        root: isWindowScroll ? null : this.scrollContainer,
        threshold: 0.1,
        rootMargin: '-40% 0px -59% 0px'
      });

      this.updateIntersectionObserverTargets();
    }

    setupEventListeners() {
      this.onScroll = () => this.scheduleActiveSync();
      this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

      this.onClick = (e) => {
        const dot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        if (!dot) return;
        const now = Date.now();
        if (now < this.suppressClickUntil) return;
        const id = dot.dataset.targetTurnId;
        const marker = this.markerMap.get(id);
        if (marker && marker.element) this.smoothScrollTo(marker.element);
      };
      this.ui.bar.addEventListener('click', this.onClick);

      this.onPointerDown = (ev) => {
        const dot = ev.target.closest?.(`.${TIMELINE_DOT_CLASS}`);
        if (!dot) return;
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        this.cancelLongPress();
        this.pressTargetDot = dot;
        this.pressStartPos = { x: ev.clientX, y: ev.clientY };
        this.longPressTriggered = false;
        dot.classList.add('holding');
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          if (!this.pressTargetDot) return;
          const id = this.pressTargetDot.dataset.targetTurnId;
          this.toggleStar(id);
          this.longPressTriggered = true;
          this.suppressClickUntil = Date.now() + 350;
          try { this.pressTargetDot.classList.remove('holding'); } catch { }
        }, this.longPressDuration);
      };
      this.onPointerMove = (ev) => {
        if (!this.pressTargetDot || !this.pressStartPos) return;
        const dx = ev.clientX - this.pressStartPos.x;
        const dy = ev.clientY - this.pressStartPos.y;
        if ((dx * dx + dy * dy) > (this.longPressMoveTolerance * this.longPressMoveTolerance)) {
          this.cancelLongPress();
        }
      };
      this.onPointerUp = () => this.cancelLongPress();
      this.onPointerCancel = () => this.cancelLongPress();

      this.ui.bar.addEventListener('pointerdown', this.onPointerDown);
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      window.addEventListener('pointerup', this.onPointerUp, { passive: true });
      window.addEventListener('pointercancel', this.onPointerCancel, { passive: true });

      this.onMouseOver = (e) => {
        const dot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        if (dot) this.showTooltipForDot(dot);
      };
      this.onMouseOut = (e) => {
        const fromDot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        const toDot = e.relatedTarget?.closest?.(`.${TIMELINE_DOT_CLASS}`);
        if (fromDot && !toDot) this.hideTooltip();
      };
      this.onFocusIn = (e) => {
        const dot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        if (dot) this.showTooltipForDot(dot);
      };
      this.onFocusOut = (e) => {
        const dot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        if (dot) this.hideTooltip(true);
      };
      this.ui.bar.addEventListener('mouseover', this.onMouseOver);
      this.ui.bar.addEventListener('mouseout', this.onMouseOut);
      this.ui.bar.addEventListener('focusin', this.onFocusIn);
      this.ui.bar.addEventListener('focusout', this.onFocusOut);

      this.onWindowResize = () => this.recalculateAndRenderMarkers();
      window.addEventListener('resize', this.onWindowResize);

      this.onStorage = (e) => {
        try {
          if (!e || e.storageArea !== localStorage) return;
          const cid = this.conversationId;
          if (!cid) return;
          const expected = `claudeTimelineStars:${cid}`;
          if (e.key !== expected) return;
          let nextArr = [];
          try { nextArr = JSON.parse(e.newValue || '[]') || []; } catch { nextArr = []; }
          this.starred = new Set(nextArr.map(x => String(x)));
          for (const m of this.markers) {
            const want = this.starred.has(m.id);
            if (m.starred !== want) {
              m.starred = want;
              if (m.dotElement) {
                m.dotElement.classList.toggle('starred', m.starred);
                m.dotElement.setAttribute('aria-pressed', m.starred ? 'true' : 'false');
              }
            }
          }
        } catch { }
      };
      window.addEventListener('storage', this.onStorage);
    }

    recalculateAndRenderMarkers() {
      if (!this.conversationContainer || !this.ui.track) return;
      const elements = Array.from(document.querySelectorAll(USER_MESSAGE_SELECTOR));
      if (elements.length === 0) return;

      const positions = elements.map(el => this.getElementTop(el));
      const firstOffset = positions[0];
      const lastOffset = positions[positions.length - 1];
      let span = lastOffset - firstOffset;
      if (span <= 0) span = 1;

      const textCounts = new Map();
      this.markerMap.clear();
      this.markers = elements.map((el, idx) => {
        const text = this.normalizeText(el.textContent || '');
        const hash = this.hashText(text);
        const count = (textCounts.get(hash) || 0) + 1;
        textCounts.set(hash, count);
        const id = `u-${hash}-${count}`;
        el.dataset.claudeTimelineId = id;
        const top = positions[idx];
        const n = Math.max(0, Math.min(1, (top - firstOffset) / span));
        const marker = {
          id,
          element: el,
          summary: text,
          n,
          top,
          dotElement: null,
          starred: this.starred.has(id)
        };
        this.markerMap.set(id, marker);
        return marker;
      });

      this.renderDots();
      this.updateIntersectionObserverTargets();
      this.activeTurnId = null;
      this.updateActiveFromScroll();
    }

    renderDots() {
      this.ui.track.querySelectorAll(`.${TIMELINE_DOT_CLASS}`).forEach(n => n.remove());
      const barHeight = this.ui.bar.clientHeight || 1;
      const pad = 14;
      const minGap = 14;
      const usable = Math.max(1, barHeight - 2 * pad);
      const desired = this.markers.map(m => pad + m.n * usable);
      const positions = this.applyMinGap(desired, pad, pad + usable, minGap);
      this.yPositions = positions;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < this.markers.length; i++) {
        const m = this.markers[i];
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = TIMELINE_DOT_CLASS;
        dot.dataset.targetTurnId = m.id;
        dot.setAttribute('aria-label', m.summary);
        dot.setAttribute('tabindex', '0');
        dot.setAttribute('aria-describedby', TIMELINE_TOOLTIP_ID);
        dot.style.top = `${Math.round(positions[i])}px`;
        if (m.starred) {
          dot.classList.add('starred');
          dot.setAttribute('aria-pressed', 'true');
        } else {
          dot.setAttribute('aria-pressed', 'false');
        }
        m.dotElement = dot;
        frag.appendChild(dot);
      }
      this.ui.track.appendChild(frag);
    }

    updateActiveFromScroll() {
      if (!this.scrollContainer || this.markers.length === 0) return;
      const containerTop = this.scrollContainer === document.body || this.scrollContainer === document.documentElement || this.scrollContainer === document.scrollingElement
        ? window.scrollY
        : this.scrollContainer.scrollTop;
      const offset = containerTop + this.scrollContainer.clientHeight * 0.35;
      let active = this.markers[0];
      for (const m of this.markers) {
        if (m.top <= offset) active = m;
      }
      if (active && active.id !== this.activeTurnId) {
        this.activeTurnId = active.id;
        for (const m of this.markers) {
          if (m.dotElement) m.dotElement.classList.toggle('active', m.id === this.activeTurnId);
        }
      }
    }

    updateActiveFromVisible() {
      if (this.visibleUserTurns.size === 0) {
        this.updateActiveFromScroll();
        return;
      }
      let best = null;
      let bestTop = Number.POSITIVE_INFINITY;
      for (const el of this.visibleUserTurns) {
        const top = this.getElementTop(el);
        if (top < bestTop) {
          bestTop = top;
          best = el;
        }
      }
      if (!best) {
        this.updateActiveFromScroll();
        return;
      }
      const marker = this.markers.find(m => m.element === best);
      if (!marker) {
        this.updateActiveFromScroll();
        return;
      }
      if (marker.id !== this.activeTurnId) {
        this.activeTurnId = marker.id;
        for (const m of this.markers) {
          if (m.dotElement) m.dotElement.classList.toggle('active', m.id === this.activeTurnId);
        }
      }
    }

    scheduleActiveSync() {
      if (this.activeSyncRaf !== null) return;
      this.activeSyncRaf = requestAnimationFrame(() => {
        this.activeSyncRaf = null;
        this.updateActiveFromVisible();
      });
    }


    updateIntersectionObserverTargets() {
      if (!this.intersectionObserver) return;
      this.intersectionObserver.disconnect();
      this.visibleUserTurns.clear();
      for (const marker of this.markers) {
        if (marker.element) this.intersectionObserver.observe(marker.element);
      }
    }

    smoothScrollTo(targetElement, duration = 500) {
      const containerRect = this.scrollContainer.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const isWindowScroll = this.scrollContainer === document.body || this.scrollContainer === document.documentElement || this.scrollContainer === document.scrollingElement;
      const currentScrollTop = isWindowScroll ? window.scrollY : this.scrollContainer.scrollTop;
      const header = document.querySelector('header[data-testid="page-header"]');
      const headerOffset = header ? Math.round(header.getBoundingClientRect().height) + 2 : 0;
      const targetPosition = targetRect.top - containerRect.top + currentScrollTop - headerOffset;
      const startPosition = currentScrollTop;
      const distance = targetPosition - startPosition;
      let startTime = null;

      const step = (currentTime) => {
        if (startTime === null) startTime = currentTime;
        const timeElapsed = currentTime - startTime;
        const run = this.easeInOutQuad(timeElapsed, startPosition, distance, duration);
        if (isWindowScroll) {
          window.scrollTo(0, run);
        } else {
          this.scrollContainer.scrollTop = run;
        }
        if (timeElapsed < duration) requestAnimationFrame(step);
        else {
          if (isWindowScroll) window.scrollTo(0, targetPosition);
          else this.scrollContainer.scrollTop = targetPosition;
        }
      };
      requestAnimationFrame(step);
    }

    getElementTop(el) {
      const rect = el.getBoundingClientRect();
      const isWindowScroll = this.scrollContainer === document.body || this.scrollContainer === document.documentElement || this.scrollContainer === document.scrollingElement;
      if (isWindowScroll) return rect.top + window.scrollY;
      const containerRect = this.scrollContainer.getBoundingClientRect();
      return rect.top - containerRect.top + this.scrollContainer.scrollTop;
    }

    findCommonAncestor(elements) {
      if (!elements || elements.length === 0) return null;
      const paths = elements.map(el => {
        const chain = [];
        let cur = el;
        while (cur && cur !== document.body) {
          chain.push(cur);
          cur = cur.parentElement;
        }
        chain.push(document.body);
        return chain;
      });
      const firstPath = paths[0];
      for (const candidate of firstPath) {
        if (paths.every(p => p.includes(candidate))) return candidate;
      }
      return null;
    }

    pickScrollContainer(elements) {
      if (!elements || elements.length === 0) return null;
      const isScrollable = (el) => {
        if (!el) return false;
        const cs = window.getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 400 && rect.height > 200;
      };

      const counts = new Map();
      for (const el of elements) {
        let cur = el.parentElement;
        while (cur && cur !== document.body) {
          if (isScrollable(cur)) {
            counts.set(cur, (counts.get(cur) || 0) + 1);
          }
          cur = cur.parentElement;
        }
      }

      if (counts.size === 0) return null;
      let best = null;
      let bestScore = -1;
      counts.forEach((count, el) => {
        const rect = el.getBoundingClientRect();
        const score = count * rect.width;
        if (score > bestScore) { bestScore = score; best = el; }
      });
      return best;
    }

    showTooltipForDot(dot) {
      if (!this.ui.tooltip) return;
      const text = dot.getAttribute('aria-label') || '';
      const id = dot.dataset.targetTurnId;
      const fullText = this.starred.has(id) ? `★ ${text}` : text;
      const tip = this.ui.tooltip;
      tip.textContent = fullText;
      const rect = dot.getBoundingClientRect();
      const width = Math.min(280, Math.max(160, tip.scrollWidth));
      const height = Math.min(90, tip.scrollHeight || 60);
      const gap = 12;
      const left = Math.max(8, rect.left - width - gap);
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, rect.top + rect.height / 2 - height / 2));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.width = `${width}px`;
      tip.style.height = `${height}px`;
      tip.setAttribute('data-placement', 'left');
      tip.classList.add('visible');
      tip.setAttribute('aria-hidden', 'false');
    }

    hideTooltip(immediate = false) {
      if (!this.ui.tooltip) return;
      if (immediate) {
        this.ui.tooltip.classList.remove('visible');
        this.ui.tooltip.setAttribute('aria-hidden', 'true');
        return;
      }
      this.ui.tooltip.classList.remove('visible');
      this.ui.tooltip.setAttribute('aria-hidden', 'true');
    }

    toggleStar(turnId) {
      const id = String(turnId || '');
      if (!id) return;
      if (this.starred.has(id)) this.starred.delete(id); else this.starred.add(id);
      this.saveStars();
      const marker = this.markerMap.get(id);
      if (marker && marker.dotElement) {
        marker.starred = this.starred.has(id);
        marker.dotElement.classList.toggle('starred', marker.starred);
        marker.dotElement.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
      }
    }

    loadStars() {
      this.starred.clear();
      const cid = this.conversationId;
      if (!cid) return;
      try {
        const raw = localStorage.getItem(`claudeTimelineStars:${cid}`);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach(id => this.starred.add(String(id)));
      } catch { }
    }

    saveStars() {
      const cid = this.conversationId;
      if (!cid) return;
      try {
        localStorage.setItem(`claudeTimelineStars:${cid}`, JSON.stringify(Array.from(this.starred)));
      } catch { }
    }

    cancelLongPress() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (this.pressTargetDot) {
        try { this.pressTargetDot.classList.remove('holding'); } catch { }
      }
      this.pressTargetDot = null;
      this.pressStartPos = null;
      this.longPressTriggered = false;
    }

    normalizeText(text) {
      try {
        let s = String(text || '').replace(/\s+/g, ' ').trim();
        s = s.replace(/^\s*(you\s*said\s*[:：]?\s*)/i, '');
        s = s.replace(/^\s*((你说|您说|你說|您說)\s*[:：]?\s*)/, '');
        return s;
      } catch { return ''; }
    }

    hashText(text) {
      let h = 5381;
      for (let i = 0; i < text.length; i++) {
        h = ((h << 5) + h) + text.charCodeAt(i);
        h = h & 0xffffffff;
      }
      return (h >>> 0).toString(36);
    }

    applyMinGap(positions, minTop, maxTop, gap) {
      const n = positions.length;
      if (n === 0) return positions;
      const out = positions.slice();
      out[0] = Math.max(minTop, Math.min(positions[0], maxTop));
      for (let i = 1; i < n; i++) {
        const minAllowed = out[i - 1] + gap;
        out[i] = Math.max(positions[i], minAllowed);
      }
      if (out[n - 1] > maxTop) {
        out[n - 1] = maxTop;
        for (let i = n - 2; i >= 0; i--) {
          const maxAllowed = out[i + 1] - gap;
          out[i] = Math.min(out[i], maxAllowed);
        }
        if (out[0] < minTop) {
          out[0] = minTop;
          for (let i = 1; i < n; i++) {
            const minAllowed = out[i - 1] + gap;
            out[i] = Math.max(out[i], minAllowed);
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (out[i] < minTop) out[i] = minTop;
        if (out[i] > maxTop) out[i] = maxTop;
      }
      return out;
    }

    extractConversationIdFromPath(pathname = location.pathname) {
      try {
        const segs = String(pathname || '').split('/').filter(Boolean);
        const i = segs.indexOf('chat');
        if (i === -1) return null;
        const slug = segs[i + 1];
        if (slug && /^[A-Za-z0-9_-]+$/.test(slug)) return slug;
        return null;
      } catch { return null; }
    }

    waitForElement(selector, timeout = 10000) {
      return new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
          const el = document.querySelector(selector);
          if (el) return resolve(el);
          if (Date.now() - start > timeout) return resolve(null);
          requestAnimationFrame(tick);
        };
        tick();
      });
    }

    easeInOutQuad(t, b, c, d) {
      t /= d / 2;
      if (t < 1) return c / 2 * t * t + b;
      t--;
      return -c / 2 * (t * (t - 2) - 1) + b;
    }

    debounce(func, delay) {
      let timeout;
      return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
      };
    }

    destroy() {
      try { this.mutationObserver?.disconnect(); } catch { }
      try { this.resizeObserver?.disconnect(); } catch { }
      try { this.intersectionObserver?.disconnect(); } catch { }
      try { this.themeObserver?.disconnect(); } catch { }
      if (this.scrollContainer && this.onScroll) {
        try { this.scrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
      }
      if (this.ui.bar && this.onClick) {
        try { this.ui.bar.removeEventListener('click', this.onClick); } catch { }
        try { this.ui.bar.removeEventListener('pointerdown', this.onPointerDown); } catch { }
        try { this.ui.bar.removeEventListener('mouseover', this.onMouseOver); } catch { }
        try { this.ui.bar.removeEventListener('mouseout', this.onMouseOut); } catch { }
        try { this.ui.bar.removeEventListener('focusin', this.onFocusIn); } catch { }
        try { this.ui.bar.removeEventListener('focusout', this.onFocusOut); } catch { }
      }
      try { window.removeEventListener('pointermove', this.onPointerMove); } catch { }
      try { window.removeEventListener('pointerup', this.onPointerUp); } catch { }
      try { window.removeEventListener('pointercancel', this.onPointerCancel); } catch { }
      try { window.removeEventListener('resize', this.onWindowResize); } catch { }
      try { window.removeEventListener('storage', this.onStorage); } catch { }
      if (this.activeSyncRaf !== null) {
        try { cancelAnimationFrame(this.activeSyncRaf); } catch { }
        this.activeSyncRaf = null;
      }
      try { document.querySelector(`.${TIMELINE_BAR_CLASS}`)?.remove(); } catch { }
      try { document.getElementById(TIMELINE_TOOLTIP_ID)?.remove(); } catch { }
    }
  }

  let timelineInstance = null;
  let currentUrl = location.href;
  let timelineActive = true;
  let providerEnabled = true;
  let routeListenersAttached = false;

  const isConversationRoute = (pathname = location.pathname) => {
    return /^\/chat\/[A-Za-z0-9_-]+/.test(pathname);
  };

  const initializeTimeline = () => {
    if (timelineInstance) return;
    timelineInstance = new TimelineManager();
    timelineInstance.init();
  };

  const ensureTimeline = () => {
    if (!isConversationRoute() || !timelineActive || !providerEnabled) return;
    if (timelineInstance) return;
    const hasMessages = document.querySelector(USER_MESSAGE_SELECTOR);
    if (!hasMessages) {
      setTimeout(ensureTimeline, 400);
      return;
    }
    initializeTimeline();
    requestAnimationFrame(() => {
      try { timelineInstance?.updateActiveFromScroll(); } catch { }
    });
  };

  const handleUrlChange = () => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    if (timelineInstance) {
      try { timelineInstance.destroy(); } catch { }
      timelineInstance = null;
    }
    if (isConversationRoute() && timelineActive && providerEnabled) {
      ensureTimeline();
    }
  };

  const attachRouteListeners = () => {
    if (routeListenersAttached) return;
    routeListenersAttached = true;
    const observer = new MutationObserver(handleUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(handleUrlChange, 1000);
  };

  let booted = false;

  const boot = () => {
    if (booted) return;
    booted = true;
    const ready = () => {
      if (isConversationRoute() && timelineActive && providerEnabled) {
        ensureTimeline();
      }
      attachRouteListeners();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ready);
    } else {
      ready();
    }
  };

  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.get({ timelineActive: true, timelineProviders: {} }, (res) => {
        try { timelineActive = !!res.timelineActive; } catch { timelineActive = true; }
        try {
          const map = res.timelineProviders || {};
          providerEnabled = (typeof map.claude === 'boolean') ? map.claude : true;
        } catch { providerEnabled = true; }
        if (!timelineActive || !providerEnabled) {
          if (timelineInstance) { try { timelineInstance.destroy(); } catch { } timelineInstance = null; }
        } else {
          boot();
        }
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return;
        let changed = false;
        if ('timelineActive' in changes) {
          timelineActive = !!changes.timelineActive.newValue;
          changed = true;
        }
        if ('timelineProviders' in changes) {
          const map = changes.timelineProviders.newValue || {};
          providerEnabled = (typeof map.claude === 'boolean') ? map.claude : true;
          changed = true;
        }
        if (!changed) return;
        const enabled = timelineActive && providerEnabled;
        if (!enabled) {
          if (timelineInstance) { try { timelineInstance.destroy(); } catch { } timelineInstance = null; }
        } else if (isConversationRoute()) {
          boot();
          ensureTimeline();
        }
      });
    }
  } catch { }

  boot();
})();
