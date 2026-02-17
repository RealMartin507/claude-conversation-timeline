# Timeline TODO（给 AI Agent）

> **读者**：新 AI agent  
> **前置**：先读 `DEV_FIX_LOG.md` 了解架构基线  
> **范围**：`content.js`、`styles.css`  
> **当前版本**：1.4.0

---

## 🚫 硬规则（必须遵守）

1. 保持 `DEV_FIX_LOG.md` 中的 5 条不可打破约束
2. 禁止引入"时间轴内部滚动"交互模型（有自己滚动条的那种）
3. dot 点击跳转、active、star 功能不可退化

---

## ✅ 已完成（v1.4.0，勿重复实现）

**v1.3.0**：容器热更新、竞态防护、统一防抖、密度分桶聚合、监听泄漏修复

**v1.4.0**：鱼眼模式（Focus+Context）
- 简单模式 vs 鱼眼模式自动切换（基于 `maxFitDots`）
- 焦点区展开为独立 dot，远区折叠为聚合 dot
- 焦点跟随 active，越界时重新渲染
- Wheel 刷卡浏览（鱼眼模式下拦截 wheel 事件）
- 状态：`focusStart`、`focusEnd`、`fisheyeMode`、`scrubFocusIndex`
- 事件：`onTimelineWheel`（已在 destroy 中移除）

---

## 📋 待开发任务

**当前无待开发任务**

如需新增功能，请：
1. 先在此文档添加任务描述
2. 实现后移至"已完成"区
3. 更新 `manifest.json` 版本号
4. 更新 `DEV_FIX_LOG.md` 架构说明

---

## ❌ 明确不做

1. 时间轴内部虚拟滚动窗口（有自己滚动条）
2. 复杂展开面板/多级状态机
3. 替换 hash 算法
4. 跨文件大重构
