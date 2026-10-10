# PandaLens · 可视化数据分析工作台

> 一个**纯前端**、**中英双语**的在线数据分析工作台，用浏览器完整复刻了 Python **pandas** 最常用的数据分析能力，并把每一步操作都同步翻译成 pandas 代码。

在线访问：**https://boveyh.github.io/data-analysis-web/**

---

## 一、这是什么

PandaLens 把 pandas 的「一整套数据分析动作」搬进了浏览器：

* 载入数据 → 清洗 → 筛选 → 分组聚合 → 可视化 → 导出，全流程无需后端；
* 界面上每做一次操作，右侧/独立标签页就会生成**对应的 pandas 代码**，可以一键复制到 Jupyter 直接运行；
* 数据**只在本机浏览器内存中处理**，不会上传到任何服务器。

---

## 二、关键亮点

### 1. 功能完整：覆盖 pandas 的核心分析链路

| 能力 | 本工作台 | 对应 pandas |
| --- | --- | --- |
| 载入 CSV / TSV / JSON | 拖拽、点选、粘贴文本 | `pd.read_csv()` / `pd.read_json()` |
| 数据结构预览 | 表格视图 + 排序 + 全表搜索 + 分页 + 列显隐 | `df.head()` / `df.shape` / `df.dtypes` |
| 描述性统计 | 转置统计表（count/mean/std/min/25%/50%/75%/max） | `df.describe()` |
| 缺失值分析 | 缺失数量 / 占比 / 条形占比图 | `df.isna().sum()` |
| 频数分布 | 表格 + 横向条形图，自动排序 | `df["col"].value_counts()` |
| 条件筛选 | **可视化条件构建器**（字段 + 运算符 + 值，可叠加多条） | `df[df[...]]` |
| 表达式查询 | pandas 风格布尔表达式解析器（见下方语法） | `df.query()` |
| 排序 | 点击表头升/降序，`NaN` 始终排最后 | `df.sort_values()` |
| 分组聚合 | 多字段分组 × 多列 × 多函数（8 种聚合函数） | `df.groupby().agg()` |
| 相关系数 | Pearson / Spearman 相关矩阵 + 热力图 | `df.corr()` |
| 数据清洗 | `dropna` / `fillna` / `astype` / `drop_duplicates` / `drop` / `rename` | 同名 API |
| 交叉表 | 行列频数交叉统计 | `pd.crosstab()` |
| 导出 | 导出当前视图为 CSV（带 BOM，Excel 友好） | `df.to_csv()` |

### 2. 选择式可视化：9 种图表，全部数据驱动

柱状图、折线图、面积图、散点图、直方图、箱线图、饼图、**相关系数热力图**、堆叠柱状图。

* 图表**不是写死的**：任意选择 X 轴 / Y 轴 / 分组 series / 聚合函数（求和、均值、中位数、计数、最值、标准差、唯一值数）/ 排序方式 / Top N / 分箱数；
* 柱状图、折线图带渐变与圆角，热力图使用科学配色的发散色阶；
* 支持显示数值标签、堆叠、平滑曲线，支持一键导出 PNG。

### 3. 交互方便简洁

* **智能默认值**：自动识别「ID 类字段」并排除，优先把 `revenue`、`profit` 这类真实度量作为 Y 轴；折线图会自动选用日期字段作为时间轴；
* **示例数据一点即用**：3 个数据集（零售销售 / 鸢尾花 Iris / 小费 Tips）即时切换；
* **键盘快捷键**：`1–6` 切换标签页、`/` 聚焦搜索、`L` 切换语言、`T` 切换主题、`Ctrl/⌘ + Enter` 执行查询；
* 每个操作实时反馈：Toast 提示、行数变化徽标、图表副标题显示数据点数量。

### 4. 设计美观

* 一套 CSS 变量驱动的设计系统，**浅色 / 深色双主题**，切换即时生效并记忆偏好；
* 卡片式布局、粘性表头、等宽数字对齐、字段类型徽标（number / string / date / boolean 分色）；
* 完全响应式：宽屏双栏 → 窄屏自动堆叠；
* 尊重 `prefers-reduced-motion`，所有动画可被系统设置关闭。

### 5. 中英双语，内容完全一致

顶部一键切换 中文 / English，界面文案、标签页、统计指标名、图表标题与提示语**全部实时切换**；数据本身不做任何翻译，保证两种语言看到的是同一份内容。

---

## 三、表达式查询语法

在「筛选清洗」标签页的 `query()` 输入框中可直接书写：

```text
revenue > 1000
category == "Home"
region in ["East", "North"]
profit > 100 and returned == "No"
(region == "East" or region == "South") and units >= 3
product.str.contains("Pro")
category.startswith("E")
rating.isna()        # 缺失
not rating.isna()    # 非缺失
```

支持：`== != > >= < <=`、`and / or / not`（也接受 `& | !`）、括号分组、`in / not in`、`str.contains / startswith / endswith`、`isna / notna`。

---

## 四、本地运行

项目是零依赖的静态站点，但**必须通过 HTTP 访问**（ES Module 与 `fetch()` 在 `file://` 下会被浏览器拦截）。

```bash
# 方式一：Python
python -m http.server 5173

# 方式二：Node
npx serve -l 5173 .
```

然后打开 <http://127.0.0.1:5173/>。

### 运行自测

```bash
node tools/selftest.mjs      # 或 npm test
```

覆盖 dtype 推断、describe（含 ddof=1 样本标准差与 numpy 线性插值分位数）、`value_counts`、`groupby` 多函数聚合、查询解析器、缺失值处理、Pearson/Spearman、直方图分箱、CSV 引号/转义/BOM/CRLF/重复表头解析，并与真实 iris 数据集的公开统计值（setosa `petal_length` 均值 1.464、virginica 5.552）做交叉校验。

### 重新生成示例数据

```bash
python tools/generate_sales.py
```

---

## 五、部署到 GitHub Pages

仓库已包含纯静态资源，无需构建步骤：

1. 推送到 `main` 分支（已配置 `.nojekyll`）；
2. 仓库 **Settings → Pages**；
3. **Source** 选 `Deploy from a branch`，**Branch** 选 `main` / `/(root)`，保存；
4. 约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

也可以使用 Actions 部署，但静态站直接开 Pages 最省事。

---

## 六、目录结构

```
data-analysis-web/
├── index.html              # 单页应用结构
├── css/styles.css          # 设计系统（主题变量 / 组件 / 响应式）
├── js/
│   ├── dataframe.js        # pandas 风格的 DataFrame 引擎（列式存储）
│   ├── parse.js            # 零依赖 CSV / TSV / JSON 解析器
│   ├── charts.js           # ECharts 封装（9 种图表 + 多 CDN 兜底）
│   ├── i18n.js             # 中英双语词条与插值
│   └── app.js              # 应用主控：管线、渲染、事件、代码生成
├── data/
│   ├── sales.csv           # 默认数据集（合成，210 行 × 16 列）
│   ├── iris.csv            # 150 × 5
│   └── tips.csv            # 244 × 7
├── tools/
│   ├── generate_sales.py   # 示例数据生成器（可复现）
│   └── selftest.mjs        # 引擎自测
└── .nojekyll
```

> **关于内存中的 DataFrame**：`js/dataframe.js` 采用与 pandas 一致的**列式存储**（`{列名: [值...]}`），每个操作都返回新对象，不做原地修改 —— 与 pandas 的不可变风格保持一致。

---

## 七、技术选型

* **零构建、零框架**：原生 ES Module + 原生 DOM，克隆即用；
* **ECharts 5** 负责图表渲染（带 4 个 CDN 依次兜底，单点故障不影响使用）；
* **自研 DataFrame 引擎**：不依赖任何数据处理库，统计口径对齐 pandas / numpy（样本标准差 `ddof=1`、分位数线性插值、`corr` 使用成对完整观测）；
* **自研文件解析**：正确处理引号包裹、转义引号、CRLF、BOM、重复表头（`a, a.1, a.2`）。

---

## 八、已知限制

* 数据全部在内存中处理，建议量级在**数万行以内**；表格视图按页渲染，不会一次插入全部 DOM；
* 图表库通过 CDN 加载，首次打开需联网；离线场景可把 `echarts.min.js` 下载到本地并修改 `js/charts.js` 中的 `CDNS` 数组；
* `date` 类型识别基于常见日期格式，非常规格式会退化为字符串。

---

## Highlights (EN)

A **pure front-end**, **bilingual (zh/en)** visual analytics workbench that mirrors the pandas API in the browser.

* **Complete pipeline** — load → clean → filter → group-by → visualise → export, with no backend at all.
* **Live pandas translation** — every UI action emits the equivalent pandas snippet, copy-paste ready for Jupyter.
* **Nine chart types**, fully data-driven: bar, line, area, scatter, histogram, box, pie, correlation heatmap, stacked bar — plus PNG export.
* **Smart defaults** that skip id-like columns, pick a real measure for the Y axis, and use a date field as the line-chart time axis.
* **Zero dependencies to build** — native ES modules, a hand-written DataFrame engine and CSV parser, statistics matched to pandas/numpy (`ddof=1`, linear-interpolation quantiles, pairwise-complete correlation).
* **Designed, not just styled** — token-driven light/dark themes, responsive layout, keyboard shortcuts, and full `prefers-reduced-motion` support.
* **Your data never leaves the browser.**
