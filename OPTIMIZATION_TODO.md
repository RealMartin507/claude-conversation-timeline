# ⚡ 性能优化路线图 (Post-v1.2.0)

> **Context**: 当前版本 (v1.2.0) 功能稳定，但采用全量渲染。本计划旨在处理超长对话场景并修复潜在性能抖动。
> **Target**: 下一任 AI Agent。

---

## 🚫 核心禁区 (Critical Constraints)
**严禁修改以下经过验证的架构逻辑，否则会导致回归 Bug：**
1.  **容器定位 (Container Scope)**: 
    *   必须优先锁定 `ScrollContainer` (非 document.body) 作为 `conversationContainer`。
    *   *Reason*: Claude 新对话仅 1 条消息时，`findCommonAncestor` 锁定范围过窄，导致后续消息无法被监听。
2.  **容器保活 (Keep-Alive)**:
    *   必须在 `MutationObserver` 回调中首行调用 `ensureContainersUpToDate()`。
    *   *Reason*: Claude 会在流式输出结束时整体替换 DOM 容器。
3.  **单例监听 (Single Observer)**:
    *   保持单一 `MutationObserver`，通过逻辑区分“新消息(RAF)”与“普通变动(Debounce)”。
    *   *Reason*: 避免多重 Observer 导致的竞态条件和性能浪费。

---

## ✅ Phase 1: 基础性能加固 (High Priority)
修复 v1.2.0 中显而易见的性能隐患，代码改动小，收益高。

### 1. ResizeObserver 防抖
*   **问题**: 当前 `ResizeObserver` 直接触发 `recalculate`，拖动窗口时导致高频重排 (Layout Thrashing)。
*   **Task**: 将回调动作改为 `this.debouncedRecalculate()` 或添加 `requestAnimationFrame` 节流。

### 2. 减少强制重排 (Reflow Reduction)
*   **问题**: `recalculateAndRenderMarkers` 每次执行都全量读取所有消息的 `offsetTop`。
*   **Task**: 
    - 引入 `positions` 缓存，仅在 `Resize` 或 `Mutation` 发生时更新。
    - 确保 **读写分离**：先批量读取所有 `offsetTop` (Read)，再批量操作 DOM (Write)。

### 3. Hash 计算缓存
*   **问题**: `hashText` (FNV-1a) 在每次渲染时对所有长文本重算。
*   **Task**: 将计算结果存入 `el.dataset.timelineHash`，下次直接读取。

---

## 🚀 Phase 2: 虚拟化渲染 (Virtualization)
参考 **Reborn14/Gemini** 方案，解决长列表 (>500 items) 的内存与渲染压力。

### 1. 引入状态 (State)
```javascript
this.contentHeight = 0;      // 虚拟轨道总高度
this.yPositions = [];        // 预计算的所有点 Y 坐标
this.visibleRange = { start: 0, end: -1 }; // 当前渲染窗口
this.usePixelTop = true;     // 切换为绝对定位模式
```

### 2. 算法准备 (Algo)
*   实现 `lowerBound(arr, val)` 和 `upperBound(arr, val)` 二分查找算法。

### 3. 渲染管线改造 (Pipeline)
*   **拆分 `renderDots`**:
    *   Step A: `updateGeometry()` -> 计算总高，撑开 `.timeline-track-content`，更新 `yPositions`。
    *   Step B: `updateVirtualRender()` -> 根据 `scrollTop` 计算可视索引范围 `[start, end]`。
*   **Diff 渲染**:
    *   仅创建 `[start, end]` 范围内的 DOM 节点。
    *   主动 `.remove()` 范围外的节点。
    *   样式由 `top: 50%` (百分比) 改为 `top: 123px` (绝对像素)。

### 4. 滚动适配
*   监听 Timeline 自身的 `scroll` 事件 -> 触发 `updateVirtualRender()`。
*   修正 `active` 高亮逻辑，需判断目标 DOM 是否存在于当前虚拟视口中。

---

## 🧹 Phase 3: 健壮性 (Robustness)
1.  **内存泄露防护**: 确保 `markers` 数组在销毁或重算时，断开对 Deleted DOM 的引用。
2.  **空状态处理**: 虚拟化模式下，确保快速清空对话时（如切换分支）UI 能正确重置。
