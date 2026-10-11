/**
 * A tiny, safe arithmetic evaluator for the assistant's `calculate` tool (and the MCP tool of the same name).
 * Recursive descent over a fixed grammar — no `eval`, no `Function`, so a prompt-injected expression can do nothing but maths.
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/' | '%') unary)*
 *   unary  := ('-' | '+') unary | power
 *   power  := atom ('^' unary)?            (right-associative: 2^3^2 = 2^9)
 *   atom   := number | '(' expr ')' | name '(' args ')' | constant
 *
 * Percent literals: `15%` means 0.15 (a trailing % that is not followed by an operand), and `x % y` is modulo.
 * Thousands separators and a leading `$` are tolerated ("1,250 * 1.5").
 */

const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)), log10: Math.log10, log2: Math.log2, exp: Math.exp,
  pow: Math.pow, min: Math.min, max: Math.max, sign: Math.sign, trunc: Math.trunc,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  avg: (...a) => a.reduce((s, x) => s + x, 0) / a.length,
  sum: (...a) => a.reduce((s, x) => s + x, 0),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const s = src.replace(/(\d),(?=\d{3}(\D|$))/g, '$1').replace(/\$/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) i++;
    else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (!m) throw new Error(`Unexpected "${c}" at position ${i}`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[a-z_]/i.test(c)) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i))!;
      out.push({ t: 'id', v: m[0].toLowerCase() });
      i += m[0].length;
    } else if ('+-*/^%(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else throw new Error(`Unexpected "${c}" at position ${i}`);
  }
  return out;
}

export function evaluate(expression: string): number {
  if (expression.length > 400) throw new Error('Expression too long (max 400 characters).');
  const toks = lex(expression.replace(/\*\*/g, '^'));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
  const eat = (v: string) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    p++;
  };
  /** Does the token after the current one start an operand? (decides whether `%` is modulo or a percent literal) */
  const startsOperand = (t: Tok | undefined) => !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && (t.v === '(' || t.v === '-' || t.v === '+')));

  function atom(): number {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num') {
      p++;
      return t.v;
    }
    if (t.t === 'id') {
      p++;
      if (isOp('(')) {
        const f = FUNCS[t.v];
        if (!f) throw new Error(`Unknown function "${t.v}"`);
        p++;
        const args: number[] = [];
        if (!isOp(')')) {
          do args.push(expr());
          while (isOp(',') && (p++, true));
        }
        eat(')');
        return f(...args);
      }
      if (t.v in CONSTS) return CONSTS[t.v];
      throw new Error(`Unknown name "${t.v}"`);
    }
    if (t.v === '(') {
      p++;
      const v = expr();
      eat(')');
      return v;
    }
    throw new Error(`Unexpected "${t.v}"`);
  }
  function power(): number {
    let base = atom();
    // postfix percent literal: 15% → 0.15 (only when not followed by an operand)
    while (isOp('%') && !startsOperand(toks[p + 1])) {
      p++;
      base /= 100;
    }
    if (isOp('^')) {
      p++;
      return base ** unary();
    }
    return base;
  }
  function unary(): number {
    if (isOp('-')) return p++, -unary();
    if (isOp('+')) return p++, unary();
    return power();
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (isOp('*')) (p++, (v *= unary()));
      else if (isOp('/')) (p++, (v /= unary()));
      else if (isOp('%')) (p++, (v %= unary()));
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (isOp('+')) (p++, (v += term()));
      else if (isOp('-')) (p++, (v -= term()));
      else return v;
    }
  }

  const v = expr();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: string | number }).v}"`);
  if (!Number.isFinite(v)) throw new Error('Result is not a finite number (division by zero or overflow).');
  return v;
}
