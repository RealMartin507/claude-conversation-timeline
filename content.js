(() => {
  const USER_MESSAGE_SELECTOR = 'div[data-testid="user-message"]';
  const TIMELINE_BAR_CLASS = 'claude-timeline-bar';
  const TIMELINE_DOT_CLASS = 'claude-timeline-dot';
  const TIMELINE_TOOLTIP_ID = 'claude-timeline-tooltip';
  const DENSITY_BUCKET_SIZE_PX = 2;

  class TimelineManager {
    constructor() {
      this.scrollContainer = null;
      this.conversationContainer = null;
      this.markers = [];
      this.densityBuckets = [];
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
      this.onTimelineWheel = null;

      this.longPressDuration = 550;
      this.longPressMoveTolerance = 6;
      this.longPressTimer = null;
      this.pressStartPos = null;
      this.pressTargetDot = null;
      this.pressTargetMarkerId = null;
      this.longPressTriggered = false;
      this.suppressClickUntil = 0;

      this.conversationId = this.extractConversationIdFromPath(location.pathname);
      this.visibleRange = { start: 0, end: -1 };
      this.yPositions = [];
      this.bucketSizePx = DENSITY_BUCKET_SIZE_PX;
      this.debouncedRecalculate = this.debounce(() => this.recalculateAndRenderMarkers(), 250);

      // 鱼眼模式状态
      this.focusStart = -1;
      this.focusEnd = -1;
      this.fisheyeMode = false;
      this.scrubFocusIndex = -1;
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
      this.scrollContainer = this.pickScrollContainer(messages) || document.scrollingElement || document.documentElement || document.body;

      // 关键修复：如果找到了特定的滚动容器（非body），优先将其作为观察对象
      // 这避免了在只有一条消息时，findCommonAncestor 错误地锁定到消息的直接父Wrapper，导致后续兄弟消息无法被监听
      const common = this.findCommonAncestor(messages);
      if (this.scrollContainer instanceof Element &&
        this.scrollContainer !== document.body &&
        this.scrollContainer !== document.documentElement &&
        this.scrollContainer !== document.scrollingElement) {
        this.conversationContainer = this.scrollContainer;
      } else {
        this.conversationContainer = common || document.body;
      }

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
      // 统一的 MutationObserver：容器验证 + 智能触发更新
      // 合并了原来的 mutationObserver 和 userMessageObserver，减少重复监听
      this.mutationObserver = new MutationObserver((mutations) => {
        // 每次 Mutation 回调先主动检查容器有效性
        this.ensureContainersUpToDate();

        // 判断是否有新用户消息被添加
        let hasNewUserMessage = false;
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.(USER_MESSAGE_SELECTOR) ||
                  node.querySelector?.(USER_MESSAGE_SELECTOR))) {
                hasNewUserMessage = true;
                break;
              }
            }
          }
          if (hasNewUserMessage) break;
        }

        if (hasNewUserMessage) {
          // 新用户消息：立即更新时间轴（无防抖延迟）
          requestAnimationFrame(() => this.recalculateAndRenderMarkers());
        } else {
          // 其他 DOM 变化（如 Claude 流式回复）：防抖更新
          this.debouncedRecalculate();
        }
      });
      this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });

      this.resizeObserver = new ResizeObserver(() => {
        this.debouncedRecalculate();
      });
      if (this.ui.bar) this.resizeObserver.observe(this.ui.bar);

      try {
        this.themeObserver = new MutationObserver(() => {
          this.debouncedRecalculate();
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
      } catch { }

      this.rebuildIntersectionObserver();
      this.updateIntersectionObserverTargets();
    }

    // 主动检查容器有效性（每次 Mutation 回调时调用）
    ensureContainersUpToDate() {
      if (this.conversationContainer && document.body.contains(this.conversationContainer)) return;

      // 容器已失效（被 Claude 替换），需要重新查找
      console.log('[Timeline] Container lost, rebinding observers...');
      // 注意：此处必须用全局查询，因为旧容器已脱离 DOM
      const messages = Array.from(document.querySelectorAll(USER_MESSAGE_SELECTOR));
      if (messages.length === 0) return;

      const nextScrollContainer = this.pickScrollContainer(messages) || document.scrollingElement || document.documentElement || document.body;

      const common = this.findCommonAncestor(messages);
      let newContainer = common || document.body;

      // 优先使用 ScrollContainer（确保监听范围覆盖所有消息）
      if (nextScrollContainer instanceof Element &&
        nextScrollContainer !== document.body &&
        nextScrollContainer !== document.documentElement &&
        nextScrollContainer !== document.scrollingElement) {
        if (!common || nextScrollContainer.contains(common)) {
          newContainer = nextScrollContainer;
        }
      }

      const scrollChanged = nextScrollContainer !== this.scrollContainer;
      const containerChanged = newContainer !== this.conversationContainer;
      if (scrollChanged || containerChanged) {
        const oldScroll = this.scrollContainer;
        this.scrollContainer = nextScrollContainer;
        this.conversationContainer = newContainer;
        this.rebindObservers({ rebindScroll: scrollChanged, rebuildIntersection: true, oldScrollContainer: oldScroll });
        this.recalculateAndRenderMarkers();
      }
    }

    // 仅重新绑定 MutationObserver 到新容器（回调逻辑保持不变，无需重建 Observer）
    rebindObservers({ rebindScroll = false, rebuildIntersection = false, oldScrollContainer = null } = {}) {
      if (this.mutationObserver) {
        try { this.mutationObserver.disconnect(); } catch { }
      }
      if (this.conversationContainer) {
        this.mutationObserver.observe(this.conversationContainer, { childList: true, subtree: true });
      }
      if (rebindScroll) this.rebindScrollListener(oldScrollContainer);
      if (rebuildIntersection) this.rebuildIntersectionObserver();
      console.log('[Timeline] Observers rebound to new container');
    }

    rebindScrollListener(oldScrollContainer = null) {
      if (!this.onScroll) return;
      // 移除旧容器上的 scroll 监听（避免泄漏）
      if (oldScrollContainer) {
        try { oldScrollContainer.removeEventListener('scroll', this.onScroll); } catch { }
      }
      try { window.removeEventListener('scroll', this.onScroll); } catch { }
      try { document.removeEventListener('scroll', this.onScroll); } catch { }
      // 绑定到新容器
      if (this.scrollContainer) {
        this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });
      }
    }

    rebuildIntersectionObserver() {
      try { this.intersectionObserver?.disconnect(); } catch { }
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
    }


    setupEventListeners() {
      this.onScroll = () => this.scheduleActiveSync();
      this.scrollContainer.addEventListener('scroll', this.onScroll, { passive: true });

      this.onClick = (e) => {
        const dot = e.target.closest(`.${TIMELINE_DOT_CLASS}`);
        if (!dot) return;
        const now = Date.now();
        if (now < this.suppressClickUntil) return;
        const marker = this.resolveMarkerForDot(dot);
        if (marker && marker.element) this.smoothScrollTo(marker.element);
      };
      this.ui.bar.addEventListener('click', this.onClick);

      this.onPointerDown = (ev) => {
        const dot = ev.target.closest?.(`.${TIMELINE_DOT_CLASS}`);
        if (!dot) return;
        if (typeof ev.button === 'number' && ev.button !== 0) return;
        const marker = this.resolveMarkerForDot(dot);
        if (!marker) return;
        this.cancelLongPress();
        this.pressTargetDot = dot;
        this.pressTargetMarkerId = marker.id;
        this.pressStartPos = { x: ev.clientX, y: ev.clientY };
        this.longPressTriggered = false;
        dot.classList.add('holding');
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          if (!this.pressTargetDot || !this.pressTargetMarkerId) return;
          this.toggleStar(this.pressTargetMarkerId);
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

      this.onWindowResize = () => this.debouncedRecalculate();
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
            m.starred = this.starred.has(m.id);
          }
          this.renderDots();
          this.applyActiveState();
        } catch { }
      };
      window.addEventListener('storage', this.onStorage);

      // Wheel 刷卡浏览（鱼眼模式增强）
      this.onTimelineWheel = (ev) => {
        if (!this.fisheyeMode) return; // 简单模式不拦截，正常滚动页面
        ev.preventDefault();

        // 初始化 scrubFocusIndex（如果尚未设置）
        if (this.scrubFocusIndex < 0) {
          if (this.activeTurnId) {
            const idx = this.markers.findIndex(m => m.id === this.activeTurnId);
            this.scrubFocusIndex = idx >= 0 ? idx : 0;
          } else {
            this.scrubFocusIndex = 0;
          }
        }

        const SCRUB_STEP = 3;
        const delta = ev.deltaY > 0 ? SCRUB_STEP : -SCRUB_STEP;
        this.scrubFocusIndex = Math.max(0, Math.min(this.markers.length - 1, this.scrubFocusIndex + delta));
        this.renderDots();
      };
      this.ui.bar.addEventListener('wheel', this.onTimelineWheel, { passive: false });
    }

    recalculateAndRenderMarkers() {
      if (!this.ui.track || !this.conversationContainer) return;

      // 安全检查：确保容器仍有效（主要验证已在 Mutation 回调的 ensureContainersUpToDate 中完成）
      if (!document.body.contains(this.conversationContainer)) {
        this.ensureContainersUpToDate();
      }

      // 限定范围查询：仅在 conversationContainer 内搜索，避免全局 DOM 扫描
      const elements = Array.from(this.conversationContainer.querySelectorAll(USER_MESSAGE_SELECTOR));
      if (elements.length === 0) {
        this.markers = [];
        this.markerMap.clear();
        this.densityBuckets = [];
        this.renderDots();
        this.updateIntersectionObserverTargets();
        this.activeTurnId = null;
        return;
      }

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
      if (this.markers.length === 0) return;
      const barHeight = this.ui.bar.clientHeight || 1;
      const pad = 14;
      const minGap = 14;
      const usable = Math.max(1, barHeight - 2 * pad);

      // 计算最大可容纳的独立 dot 数量
      const maxFitDots = Math.max(1, Math.floor(usable / minGap) + 1);

      // 简单模式：全部独立 dot
      if (this.markers.length <= maxFitDots) {
        this.fisheyeMode = false;
        this.focusStart = -1;
        this.focusEnd = -1;
        const desired = this.markers.map(m => pad + m.n * usable);
        const spacedYs = this.applyMinGap(desired, pad, pad + usable, minGap);
        this.yPositions = spacedYs;

        for (const marker of this.markers) {
          marker.dotElement = null;
        }

        const frag = document.createDocumentFragment();
        for (let i = 0; i < this.markers.length; i++) {
          const marker = this.markers[i];
          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = TIMELINE_DOT_CLASS;
          dot.dataset.targetTurnId = marker.id;
          dot.setAttribute('aria-label', this.truncateText(marker.summary, 200));
          dot.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');
          dot.setAttribute('tabindex', '0');
          dot.setAttribute('aria-describedby', TIMELINE_TOOLTIP_ID);
          dot.style.top = `${spacedYs[i]}px`;
          if (marker.starred) {
            dot.classList.add('starred');
          }
          marker.dotElement = dot;
          frag.appendChild(dot);
        }
        this.ui.track.appendChild(frag);
        this.applyActiveState();
        return;
      }

      // 鱼眼模式：焦点区展开，远区聚合
      this.fisheyeMode = true;

      // 确定焦点索引（优先使用 scrubFocusIndex，否则使用 activeIndex）
      let activeIndex = 0;
      if (this.scrubFocusIndex >= 0 && this.scrubFocusIndex < this.markers.length) {
        activeIndex = this.scrubFocusIndex;
      } else if (this.activeTurnId) {
        const idx = this.markers.findIndex(m => m.id === this.activeTurnId);
        if (idx >= 0) activeIndex = idx;
      }

      // 计算焦点窗口范围
      const focusSlots = Math.max(1, maxFitDots - 2); // 预留上下各 1 个聚合 dot
      const focusHalf = Math.floor((focusSlots - 1) / 2);
      let focusStart = Math.max(0, activeIndex - focusHalf);
      let focusEnd = Math.min(this.markers.length - 1, activeIndex + focusHalf);

      // 靠近边缘时偏移窗口，充分利用 focusSlots
      if (focusEnd - focusStart + 1 < focusSlots) {
        if (focusStart === 0) {
          focusEnd = Math.min(this.markers.length - 1, focusStart + focusSlots - 1);
        } else if (focusEnd === this.markers.length - 1) {
          focusStart = Math.max(0, focusEnd - focusSlots + 1);
        }
      }

      this.focusStart = focusStart;
      this.focusEnd = focusEnd;

      // 构建渲染项
      const renderItems = [];
      if (focusStart > 0) {
        // 上方聚合 dot
        const markerIds = [];
        let sumN = 0;
        for (let i = 0; i < focusStart; i++) {
          markerIds.push(this.markers[i].id);
          sumN += this.markers[i].n;
        }
        // 固定吸附到时间轴顶端，代表整段对话的起点
        renderItems.push({ type: 'aggregate', markerIds, naturalN: 0 });
      }

      // 焦点区独立 dot：将本窗口内的 n 线性拉伸映射到 [0,1]，充满两端聚合 dot 之间的空间
      const focusStartN = this.markers[focusStart].n;
      const focusEndN = this.markers[focusEnd].n;
      const focusRange = Math.max(0.0001, focusEndN - focusStartN);
      for (let i = focusStart; i <= focusEnd; i++) {
        const remappedN = (this.markers[i].n - focusStartN) / focusRange;
        renderItems.push({ type: 'individual', marker: this.markers[i], naturalN: remappedN });
      }

      if (focusEnd < this.markers.length - 1) {
        // 下方聚合 dot
        const markerIds = [];
        let sumN = 0;
        for (let i = focusEnd + 1; i < this.markers.length; i++) {
          markerIds.push(this.markers[i].id);
          sumN += this.markers[i].n;
        }
        // 固定吸附到时间轴底端，代表整段对话的终点
        renderItems.push({ type: 'aggregate', markerIds, naturalN: 1 });
      }

      // 计算期望位置并施加最小间距
      const desired = renderItems.map(item => pad + item.naturalN * usable);
      const positions = this.applyMinGap(desired, pad, pad + usable, minGap);
      this.yPositions = positions;

      // 清空 dotElement 引用
      for (const marker of this.markers) {
        marker.dotElement = null;
      }

      // 渲染 dot 元素
      const frag = document.createDocumentFragment();
      for (let i = 0; i < renderItems.length; i++) {
        const item = renderItems[i];
        const y = positions[i];
        const dot = document.createElement('button');
        dot.type = 'button';

        if (item.type === 'aggregate') {
          dot.className = `${TIMELINE_DOT_CLASS} aggregate`;
          dot.dataset.bucketIndex = String(i); // 使用渲染项索引作为 bucketIndex
          dot.dataset.markerCount = String(item.markerIds.length > 99 ? '99+' : item.markerIds.length);

          // 检查是否有 star
          let hasStar = false;
          for (const markerId of item.markerIds) {
            const marker = this.markerMap.get(markerId);
            if (marker && marker.starred) {
              hasStar = true;
              break;
            }
          }

          const firstMarker = this.markerMap.get(item.markerIds[0]);
          const preview = this.truncateText(firstMarker?.summary || '', 120);
          const label = preview ? `${item.markerIds.length} messages: ${preview}` : `${item.markerIds.length} messages`;
          dot.setAttribute('aria-label', label);
          dot.setAttribute('aria-pressed', hasStar ? 'true' : 'false');

          if (hasStar) {
            dot.classList.add('starred');
          }

          // 关联所有 marker 到这个 dot
          for (const markerId of item.markerIds) {
            const marker = this.markerMap.get(markerId);
            if (marker) marker.dotElement = dot;
          }
        } else {
          // individual dot
          const marker = item.marker;
          dot.className = TIMELINE_DOT_CLASS;
          dot.dataset.targetTurnId = marker.id;
          dot.setAttribute('aria-label', this.truncateText(marker.summary, 200));
          dot.setAttribute('aria-pressed', marker.starred ? 'true' : 'false');

          if (marker.starred) {
            dot.classList.add('starred');
          }

          marker.dotElement = dot;
        }

        dot.setAttribute('tabindex', '0');
        dot.setAttribute('aria-describedby', TIMELINE_TOOLTIP_ID);
        dot.style.top = `${y}px`;
        frag.appendChild(dot);
      }

      this.ui.track.appendChild(frag);
      this.applyActiveState();
    }

    buildDensityBuckets(positions, bucketSizePx = 1) {
      const safeBucket = Math.max(1, Math.round(bucketSizePx));
      const byIndex = new Map();
      for (let i = 0; i < this.markers.length; i++) {
        const marker = this.markers[i];
        const y = Math.round(positions[i]);
        const bucketIndex = Math.round(y / safeBucket);
        let bucket = byIndex.get(bucketIndex);
        if (!bucket) {
          bucket = {
            bucketIndex,
            y: bucketIndex * safeBucket,
            markerIds: [],
            count: 0,
            hasActive: false,
            hasStar: false
          };
          byIndex.set(bucketIndex, bucket);
        }
        marker.bucketIndex = bucketIndex;
        bucket.markerIds.push(marker.id);
        bucket.count += 1;
        if (marker.starred) bucket.hasStar = true;
        if (marker.id === this.activeTurnId) bucket.hasActive = true;
      }
      return Array.from(byIndex.values()).sort((a, b) => a.y - b.y);
    }

    buildBucketAriaLabel(bucket) {
      const firstMarker = this.markerMap.get(bucket.markerIds[0]);
      const preview = this.truncateText(firstMarker?.summary || '', 120);
      if (!preview) return `${bucket.count} messages`;
      return `${bucket.count} messages: ${preview}`;
    }

    resolveMarkerForDot(dot) {
      if (!dot) return null;
      const targetTurnId = dot.dataset.targetTurnId;
      if (targetTurnId) return this.markerMap.get(targetTurnId) || null;

      // 聚合 dot：找到与当前阅读位置最接近的 marker
      const readingOffset = this.getCurrentReadingOffset();
      let bestMarker = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const marker of this.markers) {
        if (marker.dotElement === dot) {
          const distance = Math.abs(marker.top - readingOffset);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestMarker = marker;
          }
        }
      }

      return bestMarker;
    }

    applyActiveState() {
      if (!this.ui.track) return;

      const dots = this.ui.track.querySelectorAll(`.${TIMELINE_DOT_CLASS}`);
      dots.forEach((dot) => {
        const targetTurnId = dot.dataset.targetTurnId;
        if (targetTurnId) {
          // 独立 dot：直接比较 turnId
          dot.classList.toggle('active', targetTurnId === this.activeTurnId);
          return;
        }

        // 聚合 dot：检查 active marker 是否在这个聚合组内
        const bucketIndex = Number(dot.dataset.bucketIndex);
        if (!Number.isFinite(bucketIndex)) return;

        if (this.activeTurnId) {
          const activeMarker = this.markerMap.get(this.activeTurnId);
          if (activeMarker && activeMarker.dotElement === dot) {
            dot.classList.add('active');
          } else {
            dot.classList.remove('active');
          }
        } else {
          dot.classList.remove('active');
        }
      });
    }

    updateActiveFromScroll() {
      if (!this.scrollContainer || this.markers.length === 0) return;

      // 清除 wheel 刷卡的临时焦点索引，回到跟随 active
      this.scrubFocusIndex = -1;

      const offset = this.getCurrentReadingOffset();
      let active = this.markers[0];
      for (const m of this.markers) {
        if (m.top <= offset) active = m;
      }
      if (active && active.id !== this.activeTurnId) {
        const oldActiveTurnId = this.activeTurnId;
        this.activeTurnId = active.id;

        // 鱼眼模式下，检查 active 是否移出焦点窗口
        if (this.fisheyeMode && oldActiveTurnId !== null) {
          const newIdx = this.markers.findIndex(m => m.id === this.activeTurnId);
          if (newIdx >= 0 && (newIdx < this.focusStart || newIdx > this.focusEnd)) {
            // 焦点窗口需要移动，重新渲染
            this.renderDots();
            return;
          }
        }

        this.applyActiveState();
      }
    }

    updateActiveFromVisible() {
      if (this.visibleUserTurns.size === 0) {
        this.updateActiveFromScroll();
        return;
      }

      // 清除 wheel 刷卡的临时焦点索引，回到跟随 active
      this.scrubFocusIndex = -1;

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
        const oldActiveTurnId = this.activeTurnId;
        this.activeTurnId = marker.id;

        // 鱼眼模式下，检查 active 是否移出焦点窗口
        if (this.fisheyeMode && oldActiveTurnId !== null) {
          const newIdx = this.markers.findIndex(m => m.id === this.activeTurnId);
          if (newIdx >= 0 && (newIdx < this.focusStart || newIdx > this.focusEnd)) {
            // 焦点窗口需要移动，重新渲染
            this.renderDots();
            return;
          }
        }

        this.applyActiveState();
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
      const fullText = dot.classList.contains('starred') ? `* ${text}` : text;
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
      }
      this.renderDots();
      this.applyActiveState();
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
      this.pressTargetMarkerId = null;
      this.pressStartPos = null;
      this.longPressTriggered = false;
    }

    getCurrentReadingOffset() {
      const isWindowScroll = this.scrollContainer === document.body || this.scrollContainer === document.documentElement || this.scrollContainer === document.scrollingElement;
      const containerTop = isWindowScroll ? window.scrollY : this.scrollContainer.scrollTop;
      const containerHeight = isWindowScroll ? window.innerHeight : this.scrollContainer.clientHeight;
      return containerTop + containerHeight * 0.35;
    }

    truncateText(text, maxLen = 200) {
      const normalized = String(text || '').trim();
      if (normalized.length <= maxLen) return normalized;
      return `${normalized.slice(0, Math.max(0, maxLen - 3))}...`;
    }

    // 对一组有序 Y 坐标施加最小间距，防止 dot 视觉重叠
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
      this.cancelLongPress();
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
        try { this.ui.bar.removeEventListener('wheel', this.onTimelineWheel); } catch { }
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
  let ensureTimelineTimerId = null;

  const clearEnsureTimelineTimer = () => {
    if (ensureTimelineTimerId !== null) {
      clearTimeout(ensureTimelineTimerId);
      ensureTimelineTimerId = null;
    }
  };

  const isConversationRoute = (pathname = location.pathname) => {
    return /^\/chat\/[A-Za-z0-9_-]+/.test(pathname);
  };

  const initializeTimeline = () => {
    if (timelineInstance) return;
    timelineInstance = new TimelineManager();
    timelineInstance.init();
  };

  const ensureTimeline = () => {
    if (!isConversationRoute() || !timelineActive || !providerEnabled) {
      clearEnsureTimelineTimer();
      return;
    }
    if (timelineInstance) {
      clearEnsureTimelineTimer();
      return;
    }
    const hasMessages = document.querySelector(USER_MESSAGE_SELECTOR);
    if (!hasMessages) {
      clearEnsureTimelineTimer();
      ensureTimelineTimerId = setTimeout(() => {
        ensureTimelineTimerId = null;
        ensureTimeline();
      }, 400);
      return;
    }
    clearEnsureTimelineTimer();
    initializeTimeline();
    requestAnimationFrame(() => {
      try { timelineInstance?.updateActiveFromScroll(); } catch { }
    });
  };

  const handleUrlChange = () => {
    if (location.href === currentUrl) return;
    currentUrl = location.href;
    clearEnsureTimelineTimer();
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
          clearEnsureTimelineTimer();
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
          clearEnsureTimelineTimer();
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
