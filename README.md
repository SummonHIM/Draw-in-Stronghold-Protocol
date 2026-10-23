# Draw in Stronghold Protocol · 涂鸦画板

为[《卫戍协议：盟约（Stronghold Protocol: Alliance）》](https://github.com/sganggs/Stronghold-Protocol)（明日方舟同人自走棋塔防联机复刻）写的一个 **`trusted` 类插件**：游玩时按 `Alt` 进入绘画模式，在屏幕上画画，**同房间的所有玩家都能实时看到**。

- 画笔 / 橡皮两种模式
- 画笔可调颜色与粗细
- 圆形工具栏（进入绘画模式才显示，画面随之调暗）
- 谁都能清空画板
- 笔迹按房间隔离，仅在服务器内存中保存

## 目录结构

```
draw-board/
├── plugin.json       插件清单（class: trusted）
├── client.js         页面代码：画布 overlay、圆形工具栏、轮询同步
├── server.js         服务器代码：内存笔迹中继（HTTP 路由 + 房间清理）
├── plugin.lock.json  由 pack 生成的文件哈希锁定
└── README.md         插件的安装与使用说明
```

## 快速开始

安装与启用步骤见 [`draw-board/README.md`](draw-board/README.md)，简而言之：

1. 把 `draw-board` 文件夹放进服务器的 `plugins/`。
2. `node tools/plugin.mjs pack draw-board` 生成锁文件。
3. 在 `plugins/config.json` 钉住锁文件 SHA-256。
4. 以 `trusted-force` 启动，房主在房间插件面板开启，玩家点「同意运行」。

## 开发

- 改动任何插件文件后，重新 `pack` 生成 `plugin.lock.json`，并更新 `plugins/config.json` 里的 pin。
- 校验插件：`node tools/plugin.mjs check draw-board --strict`（在 Stronghold-Protocol 源码目录运行）。
- 打包分发：`node tools/plugin.mjs pack draw-board --zip` 生成 `plugins/_dist/draw-board-<版本>.zip`。

## 发布

本仓库用 GitHub Actions 自动打包：推送 `v*` 标签时，workflow 会拉取固定版本的 Stronghold-Protocol 源码、
运行官方 `plugin.mjs pack --zip`，并把 zip 附加到对应 Release。详见 [`.github/workflows/release.yml`](.github/workflows/release.yml)。

## 声明

- 本插件是玩家自制的非官方作品，与鹰角网络 / Yostar 无关，不包含任何官方游戏素材。
- 插件代码以 MIT 许可发布（见 [LICENSE](LICENSE)），游戏本身及其素材的版权归原权利人所有。
- 受信任插件代码能完全控制页面与服务器子进程，请只在信任的网络中启用、不要公开房间地址。
