# draw-board · 涂鸦画板

一个 `trusted` 类插件：游玩时按 `Alt` 切换「绘画模式」，在屏幕上画画，同房间的所有玩家都能实时看到。
有画笔 / 橡皮两种模式，画笔可调颜色与粗细，谁都能清空整块画板。

- 按 `Alt` 进入 / 退出绘画模式：进入时画面调暗、弹出圆形工具栏，退出后恢复明亮、游戏照常操作。
- 画笔 / 橡皮：工具栏按钮，或快捷键 `B`（画笔）/ `E`（橡皮）。
- 颜色：中心盘点击循环预设色，工具栏 🎨 打开系统取色器。
- 粗细：工具栏 ➕ / ➖，或快捷键 `[`（变细）/ `]`（加粗），范围 2–64px。中心盘显示当前大小，橡皮模式显示 `E`+大小。
- 清空：工具栏 🗑️ 清掉所有人看到的涂鸦。
- 画板按房间隔离；关闭房间即清空。

## 为什么是 trusted 类

插件系统里只有 `trusted` 类同时提供页面代码（画 overlay、监听 Alt）和服务器代码（笔迹中继），
因此「四个人都看得到」只能用这一类实现。它默认关闭，启用需要服主显式开启并钉住锁文件哈希。

## 安装

1. 把整个 `draw-board` 文件夹放进服务器的 `plugins/` 目录。
2. 在服务器目录运行：

   ```bash
   node tools/plugin.mjs pack draw-board
   ```

   这会生成 `plugins/draw-board/plugin.lock.json`（并校验插件）。

3. 计算锁文件的 SHA-256，例如（PowerShell）：

   ```powershell
   (Get-FileHash plugins\draw-board\plugin.lock.json -Algorithm SHA256).Hash.ToLower()
   ```

   然后编辑 `plugins/config.json`，钉住它：

   ```json
   { "trusted": { "draw-board": "<上面得到的 64 位十六进制>" } }
   ```

## 启用

本插件要联机（四人都看到）就必须让服务器监听通配地址 `::`，而受信任插件在通配/公网地址上
默认被拒绝，因此需要显式用 `trusted-force`（确认风险后）。Windows 上最简单的方式是双击

```
scripts\start-windows-draw.bat
```

（它就是 `start-windows.bat --scripts trusted-force`）。也可以手动：

```bash
# Windows（PowerShell）
$env:SP_PLUGIN_SCRIPTS='trusted-force'; node server/index.js

# 或直接用启动脚本传参
node scripts/launch.mjs --scripts trusted-force
```

> 只在你信任的网络（家里 / 宿舍局域网）使用，房间地址不要发给陌生人：受信任插件代码可以完全
> 控制页面与服务器子进程。

## 使用

1. 房主在房间顶部的「原版 / 插件 ×N」面板开启 `draw-board`（房间会标记为「非官方」）。
2. 每位玩家都会看到受信任插件风险提示，点「同意运行」（同意后页面会自动刷新）。
3. 游戏中按 `Alt` 进入绘画模式，拖动即可画；再按 `Alt`（或 `Esc`）退出。左下角圆形工具栏可切换画笔 / 橡皮、颜色、粗细，或清空。

## 安全

- 中继只接受真实存在的房间（房间白名单），且读写笔迹必须携带玩家自己的 `playerId`（成员令牌），外人即使猜到房间码也无法读取或乱画。
- 按房间限速、单房字节/笔数上限，防止内存被刷爆。
- 笔迹仅保存在服务器内存中，重启服务器即消失。

## 说明

- 该插件不含任何官方游戏素材。
- 受信任代码可以完全控制页面与服务器子进程，只在你信任本插件作者时启用。
- 请只在局域网 / 可信网络启用，不要把房间地址发给陌生人。
