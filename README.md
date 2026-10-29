# 世界熵 · WORLD ENTROPY

一个可直接在浏览器中试玩的非对称卡牌对战 DEMO。两名校订者围绕公共主世界与暗牌里世界展开对抗，通过四维数值、位置顺序和显现效果争夺世界的解释权。

## 试玩内容

- 完整人机对战，先后手每回合交替。
- 30 张卡组、开局 5 张手牌、每回合补至 5 张。
- 1—6 号位出牌、公共主世界乘数、里世界加数。
- 逐张暗牌显现与卡牌效果连锁。
- 先手锚定值 3，平衡双方里世界数量差。
- 回合计分、手牌保留、牌库循环、放逐与决胜回合。
- 13 张 DEMO 卡牌、13 张原创 SVG 卡图；O1000 仅作为系统备用主世界生成。
- 卡牌库搜索与等级筛选、规则速查、校订记录。
- 桌面与手机响应式界面。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

开发服务器默认使用 Vite 地址。生产构建：

```bash
npm run build
npm run preview
```

## 测试

```bash
npm test          # 规则引擎单元测试
npm run lint      # 静态代码检查
npm run build     # 生产构建
```

`scripts/validate.mjs` 还会启动临时开发服务器，使用本机 Edge 完成一次真实浏览器试玩，并在结束后关闭服务器。可按本机浏览器路径调整脚本中的 `executablePath`。

## 仓库结构

```text
world-entropy-demo/       主程序（本仓库）
world-entropy-cards/      独立卡牌数据库
world-entropy-assets/     独立图片资源库
```

- [卡牌数据库](https://github.com/Rosmontic/world-entropy-cards)
- [图片资源库](https://github.com/Rosmontic/world-entropy-assets)

主程序内置两份资源的同步副本，以保证离线构建与 GitHub Pages 部署不依赖跨仓库请求：

- 卡牌副本：`src/data/cards.json`
- 卡图副本：`public/art/`

当三个仓库位于同一父目录时，可运行：

```bash
python scripts/sync_content.py
```

## 程序结构

```text
src/
  components/CardView.jsx  卡牌与卡背组件
  data/cards.json         卡牌数据同步副本
  game/engine.js          出牌、显现、效果、计分与 AI
  game/engine.test.js     规则测试
  App.jsx                 对局界面与弹窗
  App.css                 视觉与响应式布局
public/art/               原创 SVG 卡图同步副本
scripts/
  sync_content.py         内容同步
  validate.mjs            浏览器端完整回合验证
```

## 在线试玩

**[打开《世界熵》网页 DEMO](https://rosmontic.github.io/world-entropy-demo/)**

网页由 GitHub Actions 自动测试、构建并发布到 GitHub Pages。工作流位于 `.github/workflows/deploy.yml`，推送 `main` 即会触发部署；同时保留 `deploy.yml.example` 作为配置参考。Vite 使用相对资源路径，支持项目页子目录。

## DEMO 边界

这是前端单机 DEMO：没有账号、联网对战、云端存档或后端数据库。AI 仅根据公开主世界、当前维度和自己的手牌行动，不读取玩家暗牌。数值与强度仍需通过更多对局测试校准。

世界观与规则整合说明见 `docs/design.md`。
