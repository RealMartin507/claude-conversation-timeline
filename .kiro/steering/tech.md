# 技术栈

## 核心技术

- **平台**: 浏览器扩展程序（Chrome/Edge）
- **Manifest 版本**: V3
- **语言**: 原生 JavaScript（ES6+）、CSS3、HTML5
- **无构建系统**: 直接加载源文件，无需编译

## 关键库和 API

- Chrome 扩展 API：
  - `chrome.storage.local` - 收藏消息和设置的持久化存储
  - Content Scripts - DOM 注入和操作
  - Popup UI - 扩展设置界面
- Web API：
  - MutationObserver - DOM 变化检测
  - IntersectionObserver - 视口可见性追踪
  - ResizeObserver - 布局变化检测
  - requestAnimationFrame - 平滑动画

## 开发与测试

### 安装（开发者模式）
1. 在浏览器地址栏输入 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目目录

### 测试
- 在 https://claude.ai/* 页面上测试
- 验证浅色和深色主题
- 测试不同长度的对话（短、中、长）
- 验证收藏消息在页面重新加载后持久化

### 无构建命令
此项目无构建、编译或打包步骤。文件由浏览器直接加载。

## 浏览器兼容性

- Chrome（Manifest V3）
- Edge（Manifest V3）
