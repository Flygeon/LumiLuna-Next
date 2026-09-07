/**
 * Kazumi 兼容的 XPath 求值引擎（基于浏览器原生 XPath 1.0）。
 *
 * Kazumi（参考项目）用 Dart `xpath_selector` 库执行规则 XPath，其语义与原生
 * XPath 1.0 有三处差异（依据 xpath_selector 的 execute()：`tmp` 初始为
 * [context]，`//` 步骤做 `descentOrSelf(context)`，位置谓词作用于扁平化
 * 过滤后的列表），这里用「表达式改写 + document.evaluate」精确对齐：
 *
 * 1. `//` 步骤从「上下文节点」的后代中搜索，不是从文档根
 *    → 改写为 `.//`（对上下文节点求值时 scope 到它下面）。
 * 2. `//div[N]` / `//div[last()]` 的位置谓词作用于扁平化后代列表的第 N 个，
 *    不是每个父级的第 N 个 div 子节点
 *    → 位置谓词移出括号：`(.//div)[N]`。
 * 3. `/text()` 与 `/@attr` 是「函数/属性选择器」：返回元素本身，文本/属性
 *    由调用方在结果元素上读取
 *    → 步骤改写为 `./self::*`，避免原生 `./text()`/`./@attr` 返回文本/
 *    属性节点（那会改变后续步骤的上下文与结果类型）。
 *
 * 谓词运算符翻译：Kazumi 支持 `~=`（单词包含）/ `*=` / `^=` / `$=`，XPath 1.0
 * 没有，翻译为 contains / starts-with / substring 组合。
 */

/** 位置谓词：整数下标、last()、position()（含带运算的形式） */
function isPositionPredicate(pred: string): boolean {
  const p = pred.trim();
  if (/^\d+$/.test(p)) return true;
  return p.includes("last(") || p.includes("position(");
}

/** 把 Kazumi 谓词运算符翻译成 XPath 1.0 表达式 */
function translatePredicateOps(pred: string): string {
  // text() 在谓词里指「节点全部文本」，等价原生 `.` 的 string-value
  let out = pred.replace(/\btext\(\)/g, ".");
  // @attr~='v' → 词边界包含（class 常用）
  out = out.replace(
    /@([\w-]+)\s*~=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,
    (_m, attr: string, quote: string) => {
      const v = quote.slice(1, -1);
      return `contains(concat(' ', normalize-space(@${attr}), ' '), ' ${v} ')`;
    },
  );
  // @attr*='v' → 子串包含
  out = out.replace(
    /@([\w-]+)\s*\*=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,
    (_m, attr: string, quote: string) => `contains(@${attr}, ${quote})`,
  );
  // @attr^='v' → 前缀
  out = out.replace(
    /@([\w-]+)\s*\^=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,
    (_m, attr: string, quote: string) => `starts-with(@${attr}, ${quote})`,
  );
  // @attr$='v' → 后缀（XPath 1.0 无 ends-with，用 substring 模拟）
  out = out.replace(
    /@([\w-]+)\s*\$=\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g,
    (_m, attr: string, quote: string) =>
      `substring(@${attr}, string-length(@${attr}) - string-length(${quote}) + 1) = ${quote}`,
  );
  return out;
}

/** 从步骤 body 里切出谓词（[] 深度 + 引号感知），保留原始顺序 */
function splitPredicates(body: string): { nodeTest: string; predicates: string[] } {
  const predicates: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "[") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "]") {
      depth--;
      if (depth === 0 && start >= 0) {
        predicates.push(body.slice(start + 1, i));
        start = -1;
      }
      continue;
    }
  }
  // 移除谓词后剩下的节点测试/轴部分
  let nodeTest = body;
  for (const pred of predicates) {
    nodeTest = nodeTest.replace(`[${pred}]`, "");
  }
  return { nodeTest, predicates };
}

/** 单个步骤。expr 是可直接对上下文节点求值的原生 XPath 片段。 */
export interface XPathStep {
  descendant: boolean;
  /** 该步骤的节点测试 + 谓词（原始，未翻译运算符） */
  body: string;
  /** 改写后的原生 XPath 片段（含 ./ 或 .// 前缀） */
  expr: string;
  /** 该步骤是否为 @attr / text() 等「提取型」步骤（结果元素需读取属性/文本） */
  extract: "none" | "attr" | "text";
  attrName: string | null;
}

/**
 * 把 Kazumi 规则表达式切分为步骤并改写。
 * 返回 null 表示表达式为空 / 无法解析（调用方按「无结果」处理）。
 */
export function tokenizePath(path: string): XPathStep[] | null {
  const steps: XPathStep[] = [];
  let i = 0;
  while (i < path.length) {
    // 跳过步骤间的空白（Kazumi 的 parseSelectGroup 对每个 path trim）
    while (i < path.length && /\s/.test(path[i])) i++;
    if (i >= path.length) break;
    const ch = path[i];
    if (ch !== "/") return null; // 非法：步骤必须以 / 或 // 开头
    const descendant = path[i + 1] === "/";
    i += descendant ? 2 : 1;
    // 读取步骤 body，直到深度 0 的 /（谓词内的 / 不拆分）
    let body = "";
    let depth = 0;
    let quote: string | null = null;
    while (i < path.length) {
      const c = path[i];
      if (quote) {
        body += c;
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        body += c;
        i++;
        continue;
      }
      if (c === "[") {
        depth++;
        body += c;
        i++;
        continue;
      }
      if (c === "]") {
        depth--;
        body += c;
        i++;
        continue;
      }
      if (c === "/" && depth === 0) break;
      body += c;
      i++;
    }
    if (body.length === 0) return null; // 空步骤非法
    steps.push({ descendant, body, expr: "", extract: "none", attrName: null });
  }
  if (steps.length === 0) return null;
  for (const step of steps) {
    Object.assign(step, buildStepExpr(step.descendant, step.body));
  }
  return steps;
}

function buildStepExpr(
  descendant: boolean,
  body: string,
): Pick<XPathStep, "expr" | "extract" | "attrName"> {
  const prefix = descendant ? ".//" : "./";

  // 提取型：@attr / text() / string() 等函数选择器（node() 除外，它是节点测试）
  const attrMatch = /^@([\w-]+)$/.exec(body);
  if (attrMatch) {
    return {
      expr: `${prefix}self::*`,
      extract: "attr",
      attrName: attrMatch[1],
    };
  }
  if (/^(?!node\b)[\w-]+\(\s*\)$/.test(body)) {
    return {
      expr: `${prefix}self::*`,
      extract: body === "text()" || body === "string()" ? "text" : "none",
      attrName: null,
    };
  }

  const { nodeTest, predicates } = splitPredicates(body);
  if (nodeTest.length === 0) return { expr: "", extract: "none", attrName: null };

  const posPreds = predicates.filter(isPositionPredicate);
  const otherPreds = predicates.filter((p) => !isPositionPredicate(p));
  const base = `${nodeTest}${otherPreds.map((p) => `[${translatePredicateOps(p)}]`).join("")}`;

  if (descendant && posPreds.length > 0) {
    // 位置谓词移出括号：作用于扁平化后代列表
    const pos = posPreds.map((p) => `[${translatePredicateOps(p)}]`).join("");
    return { expr: `(${prefix}${base})${pos}`, extract: "none", attrName: null };
  }
  const extra =
    posPreds.length > 0 ? `${posPreds.map((p) => `[${translatePredicateOps(p)}]`).join("")}` : "";
  return { expr: `${prefix}${base}${extra}`, extract: "none", attrName: null };
}

/** 把规则 XPath 拆成若干路径（`|` 并集，深度 0 且不在引号内） */
function splitUnion(expr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "[") depth++;
    if (c === "]") depth--;
    if (c === "|" && depth === 0) {
      out.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  out.push(expr.slice(start));
  return out.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** 对单个上下文节点求单个步骤；返回快照里的 Element（去重） */
function evalStep(stepExpr: string, context: Element): Element[] {
  const doc = context.ownerDocument;
  if (!doc) return [];
  const result = doc.evaluate(
    stepExpr,
    context,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const out: Element[] = [];
  for (let i = 0; i < result.snapshotLength; i++) {
    const node = result.snapshotItem(i);
    if (node && node.nodeType === 1) out.push(node as Element);
  }
  return out;
}

const hasDocument = () => typeof document !== "undefined";

/** 取 DOM 文档根元素；纯 Web 预览等无 document 环境返回 null */
export function parseHtml(raw: string): Element | null {
  if (!hasDocument()) return null;
  const doc = new DOMParser().parseFromString(raw, "text/html");
  return doc.documentElement;
}

/**
 * 求值规则 XPath，返回命中的元素（按 Kazumi 的扁平化 + 去重语义）。
 * context 为元素节点（列表项 / 文档根）；表达式里的 `//` 以 context 为界。
 */
export function queryNodes(xpath: string, context: Element): Element[] {
  if (!xpath.trim()) return [];
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const path of splitUnion(xpath)) {
    const steps = tokenizePath(path);
    if (!steps || steps.length === 0) continue;
    let current: Element[] = [context];
    for (const step of steps) {
      const next: Element[] = [];
      for (const node of current) {
        for (const hit of evalStep(step.expr, node)) {
          // 本步骤内去重（Kazumi addAllIfNotExist）
          if (!next.includes(hit)) next.push(hit);
        }
      }
      if (next.length === 0) {
        current = [];
        break; // 提前剪枝：后续步骤无意义
      }
      current = next;
    }
    // 路径末尾的命中按出现顺序并入结果，跨路径去重
    for (const node of current) {
      if (!seen.has(node)) {
        seen.add(node);
        out.push(node);
      }
    }
  }
  return out;
}

/** 首个命中元素；无命中返回 null */
export function queryFirstNode(xpath: string, context: Element): Element | null {
  const nodes = queryNodes(xpath, context);
  return nodes.length > 0 ? nodes[0] : null;
}

/**
 * 读取匹配元素的文本（Kazumi `node.text` ≈ textContent），无命中返回 ""。
 * 表达式最后一步为 `text()` 时同样返回该元素的全部文本。
 */
export function queryText(xpath: string, context: Element): string {
  const node = queryFirstNode(xpath, context);
  return node ? (node.textContent ?? "").trim() : "";
}

/**
 * 读取匹配元素的属性（Kazumi `node.attributes['href']`）。表达式最后一步为
 * `@href` 时仍返回该元素的 href（步骤已被改写为 self::*，元素保留）。
 * 无命中返回 ""。
 */
export function queryAttr(xpath: string, context: Element, attr: string): string {
  const node = queryFirstNode(xpath, context);
  return node ? (node.getAttribute(attr) ?? "").trim() : "";
}
