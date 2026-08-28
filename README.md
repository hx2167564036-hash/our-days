# 我们的日子 · 二人生活记录网站

一个专为两个人打造的生活记录小站：记录生活点滴、收藏想去的地方、用转盘决定出门做什么。

- **零第三方依赖**：后端只用 Python 标准库（`http.server` + `sqlite3`），装好 Python 就能跑。
- **数据本地存储**：SQLite 单文件数据库 `data.db`，备份就是复制这一个文件。
- **手机/电脑都能用**：响应式布局，手机端体验最佳。

## 功能

| 模块 | 说明 |
|------|------|
| 🏠 首页 | 在一起天数实时计算、纪念日倒数、数据概览 |
| 📖 时光 | 图文生活记录、心情、时间轴（按月份分组、按作者筛选，支持编辑） |
| 📍 想去 | 收藏想去的地方：分类、想去程度、地址备注、标记"已打卡"（支持编辑） |
| 🎡 出门 | 活动点子库 + 大转盘随机抽取（解决"今天去哪/干嘛"，支持编辑） |
| ⚙️ 设置 | 两人名字、在一起的日子、纪念日管理、🔒访问口令、💾数据导出 |

## 本地运行

```bash
cd our-days
python3 server.py
# 打开 http://localhost:8000
```

端口默认 8000，可用环境变量修改：`PORT=9000 python3 server.py`

## 部署到服务器

### 方式一：systemd + Nginx（推荐，最省资源）

1. 把整个 `our-days` 目录上传到服务器，例如 `/opt/our-days`：

```bash
scp -r our-days user@你的服务器:/opt/our-days
```

2. 配置 systemd 服务（见 `deploy/our-days.service`）：

```bash
sudo cp deploy/our-days.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now our-days
```

3. 配置 Nginx 反向代理（见 `deploy/nginx.conf`），可加 HTTPS：

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/our-days
sudo ln -s /etc/nginx/sites-available/our-days /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 方式二：Docker

```bash
cd our-days
docker build -t our-days .
docker run -d --name our-days -p 8000:8000 -v "$PWD/data:/app/data" our-days
```

### 数据备份

复制 `data.db` 文件即可完成全部数据备份：

```bash
cp data.db data.db.bak.$(date +%F)
```

上传的图片在 `static/uploads/` 目录，一并备份即可。

## 目录结构

```
our-days/
├── server.py          # 后端（纯标准库）
├── data.db            # SQLite 数据库（首次运行自动生成）
├── static/
│   ├── index.html     # 页面
│   ├── style.css      # 样式
│   ├── app.js         # 前端逻辑
│   └── uploads/       # 上传的图片
└── deploy/            # 部署配置
    ├── our-days.service
    └── nginx.conf
```

## 后续计划

- [ ] 纪念日提醒通知
- [ ] 时光胶囊、情侣券等互动玩法
- [ ] 数据导入（从备份 JSON 恢复）
- [ ] 多图上传（一条记录多张照片）
