/**
 * 受限 JSONPath 求值（照 Kazumi `RestrictedJsonPath` 白名单）。
 *
 * 只支持以 `$` 开头，随后是：
 * - `.key`：标识符（`[A-Za-z0-9_$-]`）
 * - `[N]`：数组下标
 * - `[*]`：数组通配
 * - `['k']` / `["k"]`：引号键
 *
 * 超出白名单的表达式在 validate 阶段即抛错（与 Kazumi 的规则编辑器行为一致，
 * 避免把任意表达式塞给 json_path 包）。
 */

export class AnimeJsonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnimeJsonPathError";
  }
}

/** 校验表达式语法；非法时抛出带定位的说明 */
export function validateJsonPath(expression: string): void {
  if (!expression || !expression.startsWith("$")) {
    throw new AnimeJsonPathError(`JSONPath 必须以 $ 开头: ${expression}`);
  }
  let i = 1;
  while (i < expression.length) {
    const ch = expression[i];
    if (ch === ".") {
      i++;
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_$-]/.test(expression[i])) i++;
      if (i === start) {
        throw new AnimeJsonPathError(`不支持的 JSONPath: ${expression}`);
      }
      continue;
    }
    if (ch === "[") {
      const end = findBracketEnd(expression, i);
      const content = expression.slice(i + 1, end).trim();
      const isIndex = /^\d+$/.test(content);
      const isWildcard = content === "*";
      const isQuoted =
        content.length >= 2 &&
        ((content.startsWith("'") && content.endsWith("'")) ||
          (content.startsWith('"') && content.endsWith('"')));
      if (!isIndex && !isWildcard && !isQuoted) {
        throw new AnimeJsonPathError(`不支持的 JSONPath 片段: [${content}]`);
      }
      i = end + 1;
      continue;
    }
    throw new AnimeJsonPathError(`不支持的 JSONPath: ${expression}`);
  }
}

function findBracketEnd(expression: string, start: number): number {
  let quote: string | null = null;
  let escaped = false;
  for (let i = start + 1; i < expression.length; i++) {
    const char = expression[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote != null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "]") return i;
  }
  throw new AnimeJsonPathError(`JSONPath 缺少 ]: ${expression}`);
}

type Token =
  { kind: "key"; value: string } | { kind: "index"; value: number } | { kind: "wildcard" };

function tokenize(expression: string): Token[] {
  validateJsonPath(expression);
  const tokens: Token[] = [];
  let i = 1;
  while (i < expression.length) {
    const ch = expression[i];
    if (ch === ".") {
      i++;
      const start = i;
      while (i < expression.length && /[A-Za-z0-9_$-]/.test(expression[i])) i++;
      tokens.push({ kind: "key", value: expression.slice(start, i) });
      continue;
    }
    if (ch === "[") {
      const end = findBracketEnd(expression, i);
      const content = expression.slice(i + 1, end).trim();
      if (content === "*") tokens.push({ kind: "wildcard" });
      else if (/^\d+$/.test(content)) tokens.push({ kind: "index", value: Number(content) });
      else tokens.push({ kind: "key", value: content.slice(1, -1) });
      i = end + 1;
      continue;
    }
    i++;
  }
  return tokens;
}

/** 沿 token 求值；`[*]` 展开为多个值，其余沿单个路径下钻 */
function walk(node: unknown, tokens: Token[], index: number): unknown[] {
  if (index >= tokens.length) return [node];
  const token = tokens[index];
  if (token.kind === "wildcard") {
    if (!Array.isArray(node)) return [];
    const out: unknown[] = [];
    for (const item of node) {
      out.push(...walk(item, tokens, index + 1));
    }
    return out;
  }
  let next: unknown;
  if (token.kind === "key") {
    if (node === null || typeof node !== "object") return [];
    next = (node as Record<string, unknown>)[token.value];
  } else {
    if (!Array.isArray(node)) return [];
    next = node[token.value];
  }
  // 键/下标未命中视为「无结果」，避免把 undefined 当作命中值传回
  if (next === undefined) return [];
  return walk(next, tokens, index + 1);
}

/** 读取表达式命中的全部值（`[*]` 展开，其余为单个结果） */
export function readJsonPath(document: unknown, expression: string): unknown[] {
  return walk(document, tokenize(expression), 0);
}

/** 读取首个命中值；无命中返回 null */
export function readFirstJsonPath(document: unknown, expression: string): unknown {
  const values = readJsonPath(document, expression);
  return values.length > 0 ? values[0] : null;
}
