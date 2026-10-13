# PandaLens · 可视化数据分析工作台

> 一个**纯前端**、**中英双语**的在线数据分析工作台，用浏览器完整复刻了 Python **pandas** 最常用的数据分析能力，并把每一步操作都同步翻译成 pandas 代码。

在线访问：**https://boveyh.github.io/data-analysis-web/**

[![CI](https://github.com/boveyh/data-analysis-web/actions/workflows/ci.yml/badge.svg)](https://github.com/boveyh/data-analysis-web/actions/workflows/ci.yml)

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
| **载入 Excel** | 拖拽 `.xlsx / .xlsm`，**多工作表可切换** | `pd.read_excel(sheet_name=...)` |
| 数据结构预览 | 表格视图 + 排序 + 全表搜索 + 分页 / **虚拟滚动** + 列显隐 | `df.head()` / `df.shape` / `df.dtypes` |
| 描述性统计 | 转置统计表（count/mean/std/min/25%/50%/75%/max） | `df.describe()` |
| 缺失值分析 | 缺失数量 / 占比 / 条形占比图 / **missingno 风格缺失矩阵** | `df.isna().sum()` |
| 频数分布 | 表格 + 横向条形图，自动排序 | `df["col"].value_counts()` |
| 条件筛选 | **可视化条件构建器**（字段 + 运算符 + 值，可叠加多条） | `df[df[...]]` |
| 表达式查询 | pandas 风格布尔表达式解析器（见下方语法） | `df.query()` |
| 排序 | 点击表头升/降序，`NaN` 始终排最后 | `df.sort_values()` |
| 分组聚合 | 多字段分组 × 多列 × 多函数（8 种聚合函数） | `df.groupby().agg()` |
| **数据透视表** | **可视化透视表构建器**（行 / 列 / 值 / 聚合方式），支持热力图呈现 | `df.pivot_table()` |
| 相关系数 | Pearson / Spearman 相关矩阵 + 热力图 | `df.corr()` |
| **假设检验** | Welch t / 单因素 ANOVA / 卡方 / **Pearson 显著性** / **Mann-Whitney U** / **Kruskal-Wallis** / **Levene** / **Jarque-Bera** | `scipy.stats` |
| **时间序列** | 按日 / 周 / 月 **重采样**、**滑动窗口**（均值、和、最值、中位数、标准差）、**环比变化率**、**位移** | `resample()` / `rolling()` / `pct_change()` / `shift()` |
| 数据清洗 | `dropna` / `fillna` / `astype` / `drop_duplicates` / `drop` / `rename` | 同名 API |
| 交叉表 | 行列频数交叉统计 | `pd.crosstab()` |
| **数据体检** | 自动提示「数值列里混进了非数字文本」这类会让 pandas 静默变成 `object` 的隐患 | `df.dtypes` + `pd.to_numeric(errors="coerce")` |
| 导出 | CSV / JSON / **Excel（多工作表）** / **自包含 HTML 报告** / **Jupyter Notebook** / **pandas 脚本** | `df.to_csv()` / `to_excel()` / `to_json()` |

### 2. 选择式可视化：13 种图表，全部数据驱动

柱状图、折线图、面积图、散点图（**带最小二乘拟合线**）、直方图、箱线图、饼图、**热力图**（相关系数 / 透视表双模式）、堆叠柱状图、**缺失值矩阵**、**平行坐标图**、**散点矩阵（SPLOM）**、**正态 Q-Q 图**（附 Jarque-Bera 正态性检验）。

* 图表**不是写死的**：任意选择 X 轴 / Y 轴 / 分组 series / 聚合函数（求和、均值、中位数、计数、最值、标准差、唯一值数）/ 排序方式 / Top N / 分箱数；
* 多变量图表（平行坐标、散点矩阵）改用「数值列多选」而不是 X/Y 轴，配置面板只显示当前图表真正读取的控件；
* 柱状图、折线图带渐变与圆角，热力图使用科学配色的发散色阶（蓝 ↔ 橙，避开红绿陷阱）；
* 支持显示数值标签、堆叠、平滑曲线；主图、缺失值矩阵、频数分布图都可**一键导出 PNG**，导出失败时会说明原因（而不是静默无反应）。

### 3. 从第一性原理实现的统计推断

`js/dataframe.js` 里没有引入任何数学库，分布尾概率是手写实现的：Lanczos 近似的 `log Γ(x)`、级数 / 连分式混合的正则化不完全 Γ 函数、连分式的正则化不完全 Β 函数，由此得到 χ²、t、F 分布的尾概率；标准正态 CDF 由同一个 Γ 函数导出，`probit`（逆函数）用 Acklam 有理逼近实现。

| 检验 | 用途 | 输出 |
| --- | --- | --- |
| Welch t 检验 | 两组均值差异 | t、Satterthwaite 自由度、p、Cohen's d |
| 单因素方差分析 | 三组及以上均值差异 | F、组间/组内自由度、p、η² |
| 卡方独立性检验 | 两个分类变量是否独立 | χ²、自由度、p、Cramér's V、最小期望频数警告 |
| Pearson 相关显著性 | 两个数值列是否线性相关 | r、n、df、t、p（自动挑选相关性最强的配对列） |
| Mann-Whitney U | 两组差异，**不要求正态分布** | U、z（含结校正与连续性校正）、p、秩双列效应量 |
| Kruskal-Wallis H | 三组以上差异，不要求正态 | H（含结校正）、自由度、p、η²_H |
| Levene 检验 | 组间方差齐性 | W、自由度、p；默认以**中位数**为中心（即 Brown-Forsythe） |
| Jarque-Bera | 单变量正态性 | JB、偏度、峰度、p |

自测脚本把每个分布的关键分位点与**公开发表的临界值表**逐一对齐（例如 χ²(1) 的 3.841459、t(30) 的 2.042272），并用 `probit(0.75) = 0.6744897501960817` 这类闭式值钉住逆函数。

**更强的一层保证**：`tools/parity-test.mjs` 会把引擎的输出与**真实 pandas / numpy / scipy 跑出来的结果**逐项比对（详见第四节「与真实 pandas 的一致性」）。19 项统计量曾与 scipy 1.18.1 对齐到 `1e-9`，包括结密集（tie-heavy）的 Mann-Whitney 与 Kruskal-Wallis、以及 Levene 的两种中心点选择。

检验的输入都是**你自己选的**：分组字段、参与检验的数值字段、以及卡方要交叉的第二个分类字段。t 检验的标签里直接带上两组的均值（`Welch t 检验 · Yes (μ=51.13) vs No (μ=45.47)`）—— p 值只说明"有差异"，方向得靠均值读出来。

### 4. 交互设计：可撤销、可分享、可下钻

* **撤销 / 重做**：`Ctrl/⌘ + Z` 与 `Ctrl/⌘ + Shift + Z`，顶部按钮与「操作历史」面板联动。每一步都以**操作配方**（而不是数据快照）的形式记录，五万行数据的历史也只占几十字节；
* **操作历史可回跳**：点击任意一步右侧的 `↺` 直接退回该步骤；
* **图表下钻**：在柱、扇区、箱线图元素上点击，即可把该类别直接追加为筛选条件，并同步生成 pandas 代码；
* **透视表构建器**：行 / 列 / 值 / 聚合方式四个选择器即点即出，「热力图」图表可一键切到透视表模式，把同一份配置渲染成颜色矩阵；表格与热力图读的是同一份配置，不会互相漂移；
* **分享链接**：把当前视图编码进 URL。链接里**只有操作配方，没有任何一行数据**——别人打开后在自己的浏览器里重放你的步骤；
* **色盲友好配色**：一键切换到 Okabe–Ito 八色调色板，偏好写入本地存储。

配套的易用细节：

* **智能默认值**：自动识别「ID 类字段」并排除，优先把 `revenue`、`profit` 这类真实度量作为 Y 轴；折线图会自动选用日期字段作为时间轴；透视表的行 / 列 / 值会挑**低基数的分类列**而不是主键或时间戳（后者会产生上千万个空单元格，既是性能炸弹也是无意义的默认值）；
* **数据体检提示**：当一个数值列里混进了少量非数字文本（例如同一个字段里既有 `1200` 又有 `N/A`）时，表格上方会明确提示——pandas 会因此把这列静默变成 `object`，而后所有数值计算都悄悄失效；
* **经典数据集一键切换**：内置 10 个广为人知的数据集，覆盖分类、回归、时间序列、缺失值清洗等典型场景，从 144 行到 53,940 行不用下载任何文件即可切换；
* **键盘快捷键**：`1–6` 切换标签页、`/` 聚焦搜索、`L` 切换语言、`T` 切换主题、`Ctrl/⌘ + Z` 撤销、`Ctrl/⌘ + Enter` 执行查询；
* 每个操作实时反馈：Toast 提示、行数变化徽标、图表副标题显示数据点数量。

### 5. 大数据的性能处理

* **解析移入 Web Worker**：几十 MB 的 CSV 分词不再阻塞主线程；Worker 不可用（如 `file://`）时自动回退到同步解析，功能不降级；
* **虚拟滚动**：表格切换到「虚拟滚动（全部）」后，DOM 里永远只有一屏多一点的行，53,940 行的 `diamonds` 与 40 行数据一样流畅；上下两根占位行撑起真实滚动高度；
* **透视表单元格预算**：交叉表的代价就是笛卡尔积，所以它有一个明确的上限；超预算时界面给出提示而不是把标签页卡死；
* **不假设数据规模**：曾经用 `Math.min(...arr)` 求最值，它在 13 万元素左右就会抛 `RangeError: Maximum call stack size exceeded`，而网站接受任意大小的上传文件。现在这类地方一律走循环，并有 20 万行的断言兜底；
* **实测数字**（`npm run test:bench`，53,940 × 10 的 `diamonds`，取 5 次中位数）：解析 + 类型推断 85 ms、`describe()` 115 ms、`corr()` 66 ms、`sortValues()` 60 ms、`groupby()` 14 ms、`pivotTable()` 16 ms、`query()` 5 ms。基准同时充当**算法复杂度回归门**：把某个 O(n) 改成 O(n²) 会立刻超标，而机器抖动不会。

### 6. 设计美观

* 一套 CSS 变量驱动的设计系统，**浅色 / 深色双主题**，切换即时生效并记忆偏好；
* 卡片式布局、粘性表头、等宽数字对齐、字段类型徽标（number / string / date / boolean 分色）；
* 完全响应式：宽屏双栏 → 窄屏自动堆叠；
* 无障碍：标签页 / 面板的 `role` 与 `aria-selected`、表头 `scope="col"` 与 `aria-sort`、可键盘排序的表头、Toast 的 `aria-live` 区域、全局 `:focus-visible` 焦点环；
* **图表的可读替代**：ECharts 画在 canvas 上，屏幕阅读器读不到任何内容。所以每张图都会同时生成一份 `.sr-only` 的表格（图表的系列与数据点）以及 `role="img"` + `aria-label` 摘要——数据量大时明确标注已被截断，而不是假装完整；
* 尊重 `prefers-reduced-motion`，所有动画可被系统设置关闭。

### 7. 中英双语，内容完全一致

顶部一键切换 中文 / English，界面文案、标签页、统计指标名、图表标题与提示语**全部实时切换**；数据本身不做任何翻译，保证两种语言看到的是同一份内容。词条集中存放在 `js/i18n.js`，构建期由 `tools/deps-audit.mjs` 强制校验两种语言**键集合与插值占位符完全一致**。

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

项目是零依赖的静态站点，但**必须通过 HTTP 访问**（ES Module、`fetch()` 与 Web Worker 在 `file://` 下会被浏览器拦截）。

```bash
# 仓库自带的零依赖静态服务器
npm run serve           # → http://127.0.0.1:5173/

# 或者用你习惯的方式
python -m http.server 5173
npx serve -l 5173 .
```

### 测试

四层验证，前三层不需要浏览器，总共几秒钟就跑完：

```bash
npm test          # 引擎自测 + 接线审计 + pandas 对照 + Excel 往返
npm run test:e2e  # 真实 Chrome 里跑 167 项端到端断言
npm run test:all  # 全部
```

| 命令 | 覆盖内容 | 规模 |
| --- | --- | --- |
| `npm run test:engine` | dtype 推断、describe（`ddof=1` 与 numpy 线性插值分位数）、`value_counts`、`groupby` 多函数聚合、查询解析器、缺失值处理、Pearson/Spearman、直方图分箱、CSV 引号/转义/BOM/CRLF/重复表头解析、**三个分布尾概率对齐公开发表的临界值表**、Welch t / ANOVA / 卡方与效应量、8 项新增统计检验、时间序列、透视表、**20 万行的规模断言**；并与真实数据集公开统计值交叉校验（iris setosa `petal_length` 均值 1.464、virginica 5.552） | **231 项** |
| `npm run test:parity` | 与真实 pandas 的逐项对照，见下一节 | **308 项** |
| `npm run test:xlsx` | Excel 往返：空单元格、日期、空行、非法工作表名去重、`.xls` 必须被明确拒绝 | 15 项 |
| `npm run test:audit` | 静态接线检查：`app.js` 选中的每个 `#id` 是否存在于 `index.html`、用到的每个词条是否在 zh/en 双侧定义且插值占位符一致、HTML/JS 里出现的每个 CSS 类是否真的被样式表定义（**包括导出的 HTML 报告里的内联样式表**）、重复 id 与失效的 `aria-*` 引用 | 360 词条 / 150 id / 155 类 |
| `npm run test:bench` | 引擎基准，同时充当算法复杂度回归门 | 10 个操作 |
| `npm run test:e2e` | 起一个真实的 HTTP 服务，在真实 Chrome 里验证：模块与 Worker 能加载、爬遍 6 个标签页、缺失矩阵与检验表格渲染、撤销/重做（含快捷键）、分享链接往返恢复、图表点击下钻、虚拟滚动窗口填满视口、色盲调色板、无障碍属性、深色主题、**Excel 上传 + 工作表切换**、**六种导出格式各自真的落地成文件**（并回读校验内容）、**零 console 报错**。中段专门跑**拖入自备 CSV 的完整链路**：解析 → 统计 → 缺失图 → 假设检验 → 图表 → 筛选 → 撤销 → 分享链接 | **167 项** |

> 端到端测试需要本机有 Chrome/Chromium，并安装 `puppeteer-core`（`npm i` 即可）。Chrome 的查找顺序是 `CHROME_PATH` → puppeteer 缓存 → 各系统常见安装路径，也可以用 `NODE_PATH` 指向已有的 `node_modules`。

想看一眼各个界面的实际样子：

```bash
npm run shots     # 输出到 tools/e2e/artifacts/（已 gitignore）
```

### 内置数据集

侧边栏「经典数据集」中可在 10 个数据集之间随时切换，切换时会重置筛选 / 清洗 / 图表配置并生成新的 pandas 载入代码：

| 数据集 | 规模 | 适合演示 |
|---|---|---|
| 零售销售 `sales` | 210 × 16 | 默认数据集，业务指标、分组聚合、Python 合成的可复现数据 |
| 鸢尾花 `iris` | 150 × 5 | 最经典的分类数据集，描述统计与箱线图 |
| 小费 `tips` | 244 × 7 | 分类 + 数值混合，分组聚合与频数分布 |
| 泰坦尼克号 `titanic` | 891 × 15 | 真实数据、**含缺失值**，清洗与筛选的最佳素材 |
| 帕尔默企鹅 `penguins` | 344 × 7 | 鸢尾花的现代替代，**含缺失值** |
| 航班乘客 `flights` | 144 × 3 | 经典时间序列（Box–Jenkins 航空客流） |
| 汽车油耗 `mpg` | 398 × 9 | 多变量回归、相关性分析 |
| 世界各国 `gapminder` | 1,704 × 6 | 面板数据，国家 × 年份的二维聚合 |
| 纽约出租车 `taxis` | 6,433 × 14 | 真实业务流水，含日期时间字段 |
| 钻石 `diamonds` | 53,940 × 10 | 大数据量，价格分布与类别维度 |

### 数据来源与维护

`data/` 下的 CSV 全部原样取自公开数据源：

* `sales.csv` —— 本项目合成，可用 `python tools/generate_sales.py` 重新生成；
* 其余 9 个 —— seaborn 官方数据集仓库 [`mwaskom/seaborn-data`](https://github.com/mwaskom/seaborn-data)；
* `gapminder.csv` —— [`plotly/datasets`](https://github.com/plotly/datasets) 的 Gapminder 五年度面板数据。

侧边栏卡片上标注的行列数由 `tools/dataset-stats.mjs` 用**与应用完全相同的解析器**实测得出，不是手写的：

```bash
node tools/dataset-stats.mjs
```

改动任何一个 CSV 之后重跑一次，即可核对 `js/app.js` 里 `SAMPLE_DEFS` 的标注是否仍然准确。

---

## 五、与真实 pandas 的一致性

「参考 pandas 实现」这件事，唯一的检验方式就是**和 pandas 本身比**。但 CI 是一台没有 Python 的干净机器，所以对照被拆成两半：

```
tools/pandas_golden.py    人工跑一次真实 pandas，把答案冻结成 tools/golden/*.json
tools/parity-test.mjs     用我们自己的引擎把这些答案重新算一遍，逐项断言相等
```

于是对照**每次 push 都跑、完全离线、一秒钟内结束**——而分位数插值规则、标准差 `ddof`、`corr` 的成对完整观测、`value_counts` 的排序只要有改动，都会在这里当场失败，而不是悄悄上线。

覆盖 10 个内置数据集的 shape、列名、dtype、`isna().sum()`、`nunique()`、`describe()` 八个数、`quantile()`（含 `0.1 / 0.333 / 0.9` 三点，专门用来钉住插值规则）、`value_counts()`、`groupby` 的 count/sum/mean/median/min/max、`crosstab()`、`corr()` 全矩阵、以及 `sort_values()` 的头尾。

```bash
python tools/pandas_golden.py          # 重新生成（仅在有意改变行为后）
npm run test:parity                    # 校验
```

**唯一的、被显式钉住的分歧**：`pd.read_csv` 默认不解析日期（`parse_dates=False`），所以 `order_date`、`pickup` 这类 ISO 列在 pandas 里是文本；我们把它推断为 `date`，因为时间序列功能是打开文件就该能用的。`parity-test.mjs` 里有一份 `INTENDED_DATE_INFERENCE` 白名单，**逐列列出**这个差异，并且同时断言「白名单里的每一条都仍然成立」——既不会掩盖新出现的不一致，也不会留下过期的豁免。

---

## 六、部署到 GitHub Pages

仓库已包含纯静态资源，无需构建步骤：

1. 推送到 `main` 分支（已配置 `.nojekyll`）；
2. 仓库 **Settings → Pages**；
3. **Source** 选 `Deploy from a branch`，**Branch** 选 `main` / `/(root)`，保存；
4. 约 1 分钟后访问 `https://<用户名>.github.io/<仓库名>/`。

也可以使用 Actions 部署，但静态站直接开 Pages 最省事。

---

## 七、目录结构

```
data-analysis-web/
├── index.html              # 单页应用结构
├── css/styles.css          # 设计系统（主题变量 / 组件 / 响应式）
├── js/
│   ├── dataframe.js        # pandas 风格的 DataFrame 引擎（列式存储 + 统计推断）
│   ├── parse.js            # 零依赖 CSV / TSV / JSON 解析器
│   ├── parse.worker.js     # 同一套解析器的 Web Worker 外壳（大文件不阻塞主线程）
│   ├── xlsx.js             # Excel 读写桥接（懒加载，按需拉取下面那个库）
│   ├── charts.js           # ECharts 封装（13 种图表 + 色盲安全调色板 + 文本替代）
│   ├── i18n.js             # 中英双语词条与插值
│   ├── app.js              # 应用主控：管线、历史、URL 状态、渲染、事件、代码生成、导出
│   └── vendor/
│       ├── echarts.min.js       # 随仓库发布的 ECharts 5.5.1（1 MB，离线可用）
│       └── xlsx.mini.min.js     # 随仓库发布的 SheetJS 0.18.5 mini（245 KB，懒加载）
├── data/
│   ├── sales.csv           # 默认数据集（合成，210 × 16）
│   ├── iris.csv            # 150 × 5     经典分类
│   ├── tips.csv            # 244 × 7     账单与小费
│   ├── titanic.csv         # 891 × 15    含缺失值
│   ├── penguins.csv        # 344 × 7     含缺失值
│   ├── flights.csv         # 144 × 3     时间序列
│   ├── mpg.csv             # 398 × 9     多变量回归
│   ├── gapminder.csv       # 1,704 × 6   面板数据
│   ├── taxis.csv           # 6,433 × 14  时间字段
│   └── diamonds.csv        # 53,940 × 10 大数据量
├── tools/
│   ├── generate_sales.py   # 默认数据集生成器（可复现）
│   ├── pandas_golden.py    # 用真实 pandas 生成对照答案 → tools/golden/*.json
│   ├── golden/             # 冻结的 pandas 输出（10 个数据集，共 68 KB）
│   ├── dataset-stats.mjs   # 实测各数据集的行列数 / 体积 / 解析耗时
│   ├── selftest.mjs        # 引擎自测（231 项断言）
│   ├── parity-test.mjs     # 与 pandas 逐项对照（308 项断言，无需 Python）
│   ├── xlsx-test.mjs       # Excel 读写往返（15 项断言）
│   ├── bench.mjs           # 引擎基准 + 算法复杂度回归门
│   ├── deps-audit.mjs      # 选择器 / 词条 / CSS 类的静态接线检查
│   └── e2e/
│       ├── server.mjs      # 零依赖静态服务器（测试与本地预览共用）
│       ├── browser.mjs     # 定位 Chrome 并加载 puppeteer-core
│       ├── smoke.mjs       # 真实浏览器端到端断言（167 项）
│       └── screenshots.mjs # 各界面截图，便于人工审阅
├── .github/workflows/ci.yml # CI：引擎 / 对照 / 基准 + 浏览器端到端
└── .nojekyll
```

> **关于内存中的 DataFrame**：`js/dataframe.js` 采用与 pandas 一致的**列式存储**（`{列名: [值...]}`），每个操作都返回新对象，不做原地修改 —— 与 pandas 的不可变风格保持一致。

---

## 八、技术选型

* **零构建、零框架**：原生 ES Module + 原生 DOM，克隆即用；
* **ECharts 5.5.1** 负责图表渲染，**随仓库发布**在 `js/vendor/` 下，打开页面即从本地加载（实测 0.4 秒，无需任何网络往返，离线也能用）。另有 4 个 CDN 镜像作为兜底，仅在本地副本缺失时才会被请求；
* **SheetJS 0.18.5（mini 构建）** 负责 Excel 读写，同样随仓库发布（245 KB），并且**懒加载**——从不打开 `.xlsx` 的页面完全不会为它付出任何代价。选 mini 而不是全量版（约 1 MB）是有取舍的：mini 明确不支持旧式 `.xls` / `.xlsb` / Numbers，所以界面也只承诺 `.xlsx / .xlsm`，正好是我们真正能兑现的；
* **自研 DataFrame 引擎**：不依赖任何数据处理库，统计口径对齐 pandas / numpy（样本标准差 `ddof=1`、分位数线性插值、`corr` 使用成对完整观测），并由 308 项与真实 pandas 的对照断言看住；
* **自研统计推断**：Lanczos `log Γ`、正则化不完全 Γ / Β 函数，从零实现 χ²、t、F 分布尾概率与标准正态 CDF，不引入 scipy；
* **自研文件解析**：正确处理引号包裹、转义引号、CRLF、BOM、重复表头（`a, a.1, a.2`），并可在 Web Worker 中运行；
* **状态即配方**：撤销历史与分享链接都只保存「操作列表」，不复制数据，因此内存占用与数据规模无关；
* **性能靠算法而不是靠机器**：`describe()` 把「每个分位数排一次序」改成「整列只排一次」，`corr()` 把「每一对列重新解析两列」改成「每列只转换一次」，`sortValues()` 从「比较器里现算 key」改成「先提键再排序」。同一份 53,940 × 10 数据上，三者分别从 276 / 890 / 447 ms 降到 115 / 66 / 60 ms。

> **关于 ECharts 的加载方式**（踩过的三个坑，按发现顺序）：图表库最初完全走 CDN，带 4 个镜像依次兜底。
> 兜底链只在 `onerror` 时前移，而**被限速的镜像不会报错** —— 本机环境里 jsDelivr 25 秒只吐了 96 KB，
> 另外三个健康镜像却在旁边干等，整页图表一直空白。
> 改成并行竞速后又踩到第二个坑：镜像按下载完成顺序执行，**已经进入执行队列的落败者仍会跑完**，
> 它的 UMD 包装会再执行一次 `window.echarts = {}`，把实例注册表从已经画好的图表脚下换掉
> （症状很有迷惑性：`getInstanceByDom` 返回 undefined，而 canvas 明明就在 DOM 里）。
> 最后一个是**假 200**：`lib.baomitu.com` 对不存在的版本返回 HTTP 200，正文只有 `404: Not Found`，
> 所以 `onload` 不能作为成功信号，只有「全局真的出现了」才算。
> 现在的方案是**本地优先 + 兜底竞速 + 首写者锁定**：随仓库发布的副本覆盖绝大多数情况（0.4 秒，零网络），
> 竞速只在该副本缺席时启动，而带守卫的 setter 保证任何一个镜像都只能成为那个唯一的全局。

---

## 九、已知限制

* 数据全部在内存中处理，建议量级在**数十万行以内**；表格视图默认分页渲染，大表可切到虚拟滚动，DOM 规模恒定在一屏；
* 图表库与 Excel 库都已内置在仓库里，**无需联网即可使用全部功能**；
* Excel 只支持 `.xlsx / .xlsm`。旧式 `.xls`（BIFF 格式）需要 SheetJS 的全量构建（约 1 MB，是 ECharts 的体积），为了首屏不翻倍而放弃；界面会明确拒绝，而不是给出一个看起来像文件损坏的错误；
* `date` 类型识别基于常见日期格式，非常规格式会退化为字符串；
* 分享链接只能还原**内置数据集**上的操作；上传/粘贴的数据不会被编码进 URL（那等于把数据塞进地址栏），打开这类链接时会回落到默认数据集并给出提示；
* 假设检验面向探索性分析：卡方检验在最小期望频数 < 5 时会在界面上给出警告，但不做 Yates 连续性校正；不做 Shapiro-Wilk（其系数表庞大且在大样本下不稳定），正态性判断交给 Q-Q 图 + Jarque-Bera。

---

## Highlights (EN)

A **pure front-end**, **bilingual (zh/en)** visual analytics workbench that mirrors the pandas API in the browser.

* **Complete pipeline** — load → clean → filter → group-by → pivot → visualise → export, with no backend at all.
* **Loads what you already have** — CSV, TSV, JSON, pasted text, and **Excel workbooks (`.xlsx`/`.xlsm`) with a sheet switcher**.
* **Live pandas translation** — every UI action emits the equivalent pandas snippet, copy-paste ready for Jupyter.
* **Thirteen chart types**, fully data-driven: bar, line, area, scatter (with a least-squares fit line), histogram, box, pie, heatmap (correlation *or* any pivot table), stacked bar, missingness matrix, parallel coordinates, a scatter-plot matrix, and a normal Q-Q plot.
* **Inference from first principles** — Welch's t-test, one-way ANOVA, chi-square, Pearson significance, Mann-Whitney U, Kruskal-Wallis, Levene and Jarque-Bera, with effect sizes (Cohen's d, η², Cramér's V, rank-biserial r) computed on hand-written incomplete gamma/beta functions. Every distribution tail is pinned in CI against published critical-value tables.
* **Verified against pandas itself** — `tools/parity-test.mjs` re-derives 308 numbers that real pandas/numpy produced and asserts they match, so quantile interpolation, `ddof`, pairwise-complete correlation and `value_counts` ordering cannot drift silently. It runs offline in CI, with no Python installed.
* **Time series** — resample by day/week/month, rolling windows, percent change and shift, all in the engine.
* **Reversible and shareable** — undo/redo with a jumpable history, plus share links that encode only the recipe (never a single row of data).
* **Click to drill** — clicking a bar, slice or box appends the matching filter and regenerates the pandas code.
* **Six export formats** — CSV, JSON, a multi-sheet Excel workbook, a **self-contained HTML report** with the chart pixels inlined, a runnable Jupyter notebook, and the equivalent pandas script.
* **Built for big frames** — parsing runs in a Web Worker with a synchronous fallback, the table has a virtual-scroll mode where 50k rows cost the same DOM as 40, and nothing assumes a small frame: `Math.min(...arr)` used to throw a `RangeError` past ~130k rows, so every such site is now a loop, with a 200,000-row assertion to keep it that way.
* **Measurably fast** — `npm run test:bench` prints the numbers (on 53,940 × 10: parse 85 ms, `describe` 115 ms, `corr` 66 ms, `sort` 60 ms) and doubles as an algorithmic-regression gate.
* **Accessible by default** — tab/panel semantics, `aria-sort` headers, keyboard sorting, a polite live region for toasts, and — because ECharts draws to a canvas that screen readers cannot see — a `.sr-only` data table plus an `aria-label` summary behind every chart.
* **Zero dependencies to build** — native ES modules, a hand-written DataFrame engine and CSV parser, statistics matched to pandas/numpy.
* **No network on the critical path** — ECharts 5.5.1 and SheetJS ship in the repo (SheetJS lazily), so charts render offline in about 0.4 s. Four CDN mirrors exist as a fallback, raced against each other and locked to whichever one wins first.
* **Designed, not just styled** — token-driven light/dark themes, responsive layout, keyboard shortcuts, and full `prefers-reduced-motion` support.
* **Your data never leaves the browser.**
