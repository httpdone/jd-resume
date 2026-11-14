# 提示词与文案原创性对照报告

对照日期：2026-11-10（Asia/Shanghai）。方法：将本仓库的 `lib/agent/prompts.mjs`（及改写前后快照）、`lib/agent/mock.mjs`、`README.md`、`public/js/pages/jd.js`、`public/js/pages/editor.js` 与下列 5 个参考仓库的全部文本文件（`SKILL.md`、prompts、references、README、源码中的提示词等；排除 `.git`、`node_modules`、`LICENSE`、锁文件）做字符级 8-gram 比对；并列出长度 ≥ 12 的连续重合片段（须含至少 6 个汉字，或英文 ≥ 24 字符）。整体相似度同时给出 Jaccard（双方 8-gram 交集 / 并集）以及「覆盖率」（我方 8-gram 中出现在对方文本里的比例）。后者更能反映「我们有多少表述能在对方仓库里找到」。

本报告区分两类情况：

- **借鉴思路 / 行业常识**：如情境—任务—行动—结果（STAR）、ATS 关键词、不编造事实、缺数据不写数字、先看岗位再改简历等。这些不算抄袭。
- **文字表达高度相似 / 结构照搬**：连续中英文原文、独特的命名体系或分值表。这类已全部用自己的话重写，并调整了设计差异。

## 1. 各仓库许可

| 仓库 | 远程 | LICENSE | 结论 |
| --- | --- | --- | --- |
| [wanyichen06/LLMInternSkill](https://github.com/wanyichen06/LLMInternSkill) | 已浅克隆 | **MIT**，Copyright (c) 2026 couragec | 允许使用、复制、修改并保留版权声明。README「致谢与参考」已注明来源与许可。重写后不再保留其英文口号与四轮面试名称。 |
| [coinluu/resume-jd-optimizer-cn](https://github.com/coinluu/resume-jd-optimizer-cn) | 已浅克隆 | **MIT**，Copyright (c) 2026 coinluu | 同上。重写前存在多处中文连续重合（动词阶梯、覆盖状态、评分分值、若干提示句），已全部改写。 |
| [Elowwwen/resume-evidence-workflow](https://github.com/Elowwwen/resume-evidence-workflow) | 已浅克隆 | **MIT**，Copyright (c) 2026 Resume Evidence Workflow contributors | 允许借鉴思路。重写前几乎没有 ≥12 字的中文连续重合（注释里曾出现仓库名）。致谢中说明了「先对照再改写、证据可强可弱、不擅自删经历」等思路。 |
| [gaoweiblue-source/resume-expert](https://github.com/gaoweiblue-source/resume-expert) | 已浅克隆 | **无 LICENSE 文件**（默认保留所有权利） | 不得复制其提示词或文案。比对未见有意义的中文连续重合；剩余重合是通用 JSON/TypeScript 字段（如 `"high" \| "medium" \| "low"`）。只在致谢中说明参考了「分步结构化输出、改写对照」这类常见产品形态。 |
| [wangyafu/resume-skills](https://github.com/wangyafu/resume-skills) | 已浅克隆 | **无 LICENSE 文件**（默认保留所有权利） | 不得复制其文案。重写前、后均无 ≥12 字连续重合。已去掉与其 SKILL 中「词语领起句」完全相同的叫法，改为「要点起句」。 |

## 2. 重写前的相似度

**A. 仅 `prompts.mjs`（18 960 字符，12 845 个 8-gram）**

| 仓库 | Jaccard | 我方覆盖率 | ≥12 字有意义连续重合 |
| --- | ---: | ---: | --- |
| LLMInternSkill | 0.00275 | **1.650%** | 2 条英文口号：`Polish expression, not reality`（31）、`Diagnose first, polish second`（29） |
| resume-skills | 0.00113 | 0.163% | 无 |
| resume-expert | 0.01048 | 4.453% | 主要是通用 schema / 代码片段，如 `: "high" \| "medium" \| "low"`；另有「不要 markdown 代码块」等短句 |
| resume-evidence-workflow | 0.00298 | 1.471% | 无有意义中文长句（注释中的仓库名不计） |
| resume-jd-optimizer-cn | 0.00307 | **1.705%** | **13 条**，见下表 |

**B. 提示词 + 演示逻辑 + README + 前端文案（约 12.8 万字符）**

| 仓库 | Jaccard | 我方覆盖率 |
| --- | ---: | ---: |
| LLMInternSkill | 0.00403 | 0.785% |
| resume-skills | 0.00137 | 0.148% |
| resume-expert | 0.01785 | 2.854% |
| resume-evidence-workflow | 0.00496 | 0.865% |
| resume-jd-optimizer-cn | 0.00318 | 0.592% |

重写前，与 **resume-jd-optimizer-cn** 的连续重合（`prompts.mjs` 对应该库的 SKILL / prompts / rubrics）包括：

| 长度 | 来源 | 片段 |
| ---: | --- | --- |
| 27 | `prompts/jd_parser.md` | 可用于简历匹配的要求清单。不要根据岗位名称补充 JD |
| 25 | `SKILL.md` | 支持/协助 < 参与 < 负责 < 推动 < 主导 |
| 22 | `README.md` | 协助 < 参与 < 负责 < 推动 < 主导 |
| 22 | `prompts/interview_question_generator.md` | 优先攻击简历中最强、最可能被质疑的表述 |
| 20 | `rubrics/hr_score.md` | 不得基于年龄、性别、婚育、籍贯等敏感属性 |
| 18 | `README.md` | 已覆盖 / 弱覆盖 / 未覆盖 / |
| 17 | `prompts/resume_rewriter.md` | 关键词只在最有证据的位置重点出现； |
| 14 | `SKILL.md` | 赋能、闭环、抓手、沉淀、拉通 |
| 14 | `rubrics/jd_match_score.md` | 任一高权重硬性条件无证据时 |
| 12 | `prompts/jd_parser.md` | 把公司宣传语当关键词。 |
| 12 | `prompts/interview_question_generator.md` | 问口径、基线、周期和归因 |
| 12 | `SKILL.md` | 学校、公司、岗位、项目、 |
| 11–10 | 若干 | 关键词必须绑定真实行动；替代方案、失败情况 等较短片段 |

此外，匹配分值「硬性条件 20、技能关键词 20、项目相关度 25、成果量化 15、职级匹配 10、表达清晰 5、ATS 可读 5」与该库 `rubrics/jd_match_score.md` 的维度和分值一致，属于**结构照搬**，即使被空白拆开、n-gram 不一定连成一句，也应改掉。

与 **LLMInternSkill** 除两条英文口号外，面试追问的四轮名称「真实性边界、技术深度、JD 深挖、场景题」是对其 `skill-references/interview-grilling.md` 中 Truth Boundary / Technical Depth / JD-Specific Deep Dive / Scenario Questions 的直接翻译，亦按「结构照搬」处理。

## 3. 做了哪些修改

目标：保持原有功能与效果，但用自己的设计语言和措辞。主要改动在 `lib/agent/prompts.mjs`，并同步了 `lib/agent/mock.mjs`、`public/js/pages/jd.js`、`public/js/pages/editor.js`、示例 `data/jds.json` 与 README。

| 原设计（与某仓库高度一致） | 现在的设计 |
| --- | --- |
| 动词阶梯：支持/协助 < 参与 < 负责 < 推动 < 主导 | **配合 < 参与 < 承担 < 推进 < 牵头**。原文若使用「支持/协助、负责、推动、主导」，仅作为对照映射到新阶梯，规则仍是「语气只收不加重」 |
| 覆盖状态：已覆盖 / 弱覆盖 / 未覆盖 / 可补充 / 不建议硬凑 | **材料充分 / 表述偏弱 / 尚未体现 / 待向你确认 / 不宜牵强写入**。界面兼容读取旧状态名，以免已保存的匹配结果失色 |
| 证据类型标签：直接证据 / 可迁移 / 弱证据 / 无证据（键名 `direct/adjacent/weak/none` 保留，以免存储结构断裂） | 界面改为 **原岗实做 / 能力相近 / 仅有提及 / 材料未见**；提示词中的定义也已重写 |
| 「要求 → 证据」矩阵 | **岗位条件对照表** |
| 匹配评分 7 维：20+20+25+15+10+5+5 | **6 维 25+25+15+15+10+10**：门槛符合、相关经历、技能对应、成果可核验、职责层级、表达与版式 |
| 面试四轮：真实性边界、技术深度、JD 深挖、场景题 | **口径与边界、方案与权衡、岗位对齐、临场情境** |
| Diagnose first, polish second / Polish expression, not reality | 改为中文：「先把问题说清楚，再改措辞。只改说法，不改事实。」不再使用原英文口号 |
| 词语领起句 | **要点起句** |
| 若干高度相似的提示句（攻击最强表述、敏感属性、公司宣传语当关键词、高权重硬性条件无证据等） | 全部用自己的句子重写，见 `prompts.mjs` |
| 空话词表「赋能、闭环、抓手、沉淀、拉通」原样排列 | 改为带语境的例子：「赋能业务」「形成闭环」「打造抓手」「沉淀方法论」「横向拉通」等 |

JSON 字段名（如 `hardRequirements`、`doNotForce`、`eliminationRisk`）是描述性英文标识，不是某一仓库的中文独特表述，为避免破坏已存数据而保留。`resume-expert` 中与我们重合的也主要是这类通用字段和 `"high" | "medium" | "low"`。

## 4. 重写后的相似度

**A. 仅 `prompts.mjs`（18 797 字符，12 752 个 8-gram）**

| 仓库 | 覆盖率（前 → 后） | Jaccard（前 → 后） | ≥12 字有意义连续重合 |
| --- | --- | --- | --- |
| LLMInternSkill | 1.650% → **1.090%** | 0.00275 → 0.00180 | **0**（原先两条英文口号已删除） |
| resume-skills | 0.163% → **0.063%** | 0.00113 → 0.00043 | 仍为 0 |
| resume-expert | 4.453% → **4.368%** | 0.01048 → 0.01022 | 仍仅有通用 schema：`: "high" \| "medium" \| "low"`（27 字符） |
| resume-evidence-workflow | 1.471% → **1.176%** | 0.00298 → 0.00237 | 仍为 0 |
| resume-jd-optimizer-cn | 1.705% → **0.478%** | 0.00307 → 0.00086 | **13 → 0** |

**B. 提示词 + 演示逻辑 + README + 前端文案（重写后约 12.9 万字符）**

| 仓库 | 覆盖率（前 → 后） | Jaccard（前 → 后） |
| --- | --- | --- |
| LLMInternSkill | 0.785% → 0.750% | 0.00403 → 0.00389 |
| resume-skills | 0.148% → 0.137% | 0.00137 → 0.00126 |
| resume-expert | 2.854% → 2.778% | 0.01785 → 0.01751 |
| resume-evidence-workflow | 0.865% → 0.865% | 0.00496 → 0.00500 |
| resume-jd-optimizer-cn | 0.592% → **0.385%** | 0.00318 → 0.00208 |

要点：

- 与 **resume-jd-optimizer-cn** 的提示词覆盖率下降约 **72%**（1.705% → 0.478%），长度 ≥ 12 的中文连续重合清零。
- 与 **LLMInternSkill** 的两条英文原句已不存在；提示词覆盖率下降约 **34%**（1.650% → 1.090%）。剩余主要是「内部试用」「本地验证」一类普通词被拆散后的短 8-gram，以及「不编造」等行业用语。
- **resume-expert** 覆盖率几乎不变，原因是双方都在用同一套极其常见的 JSON 键和 `"high" | "medium" | "low"` 枚举，不是中文表述复制。该库无 LICENSE，我们没有复制其提示词。
- 绝对数字看起来都很小，是因为 8-gram 对整份提示词 + 整仓文本很「碎」；判断是否雷同，应同时看**长连续片段**和**独特设计是否照搬**。这两项在重写后均已处理。

## 5. 仍属于通用思路、不视为抄袭的部分

- 先诊断、再改写；只改措辞、不改事实；缺数据用占位符、不编数字。
- 用情境—任务—行动—结果组织经历；关键词要落到真实经历上；一页篇幅控制。
- 对照岗位条件再改简历；技能只写在技能栏、经历里看不到过程，证明力较弱。
- 面试会追问数字口径、个人职责边界、技术取舍；输出结构化 JSON，便于程序写入。
- 不根据年龄、性别、婚育、籍贯等敏感信息做评价（这是招聘合规的普遍要求，表述已改写）。

这些做法在招聘咨询和简历工具里广泛存在，不能独占。我们保留的是功能，不是某一仓库的原文或独特命名。

