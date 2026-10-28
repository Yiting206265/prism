// arXiv titles/abstracts are raw LaTeX source, so they often contain markup
// like \emph{...}, $\alpha$, or "--" for an em dash. This strips/renders that
// down to plain text for display.

const SYMBOL_COMMANDS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
  phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', pm: '±', mp: '∓', div: '÷', cdot: '·', ast: '*',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', approx: '≈', sim: '∼',
  simeq: '≃', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', mapsto: '↦',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃',
  infty: '∞', partial: '∂', nabla: '∇', sum: 'Σ', prod: '∏', int: '∫',
  ldots: '…', cdots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
  quad: ' ', qquad: '  ',
};

// Accented-letter commands, e.g. \'e -> é, \"o -> ö, \v{s} -> š.
const ACCENTS: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', c: 'ć', n: 'ń', s: 'ś', z: 'ź', l: 'ĺ', r: 'ŕ',
         A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', Y: 'Ý', C: 'Ć', N: 'Ń', S: 'Ś', Z: 'Ź' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  v: { c: 'č', s: 'š', z: 'ž', e: 'ě', n: 'ň', r: 'ř', t: 'ť', d: 'ď', l: 'ľ', C: 'Č', S: 'Š', Z: 'Ž' },
  H: { o: 'ő', u: 'ű', O: 'Ő', U: 'Ű' },
  c: { c: 'ç', C: 'Ç', s: 'ş', S: 'Ş' },
  k: { a: 'ą', e: 'ę', A: 'Ą', E: 'Ę' },
  r: { a: 'å', A: 'Å', u: 'ů', U: 'Ů' },
  u: { a: 'ă', A: 'Ă', g: 'ğ' },
};

export function cleanLatexText(input: string): string {
  if (!input) return '';
  let text = input;

  // Formatting wrappers: keep the argument, drop the command.
  text = text.replace(
    /\\(emph|textit|textbf|textsc|textrm|texttt|text|mathrm|mathbf|mathit|mathcal|mathbb|mathfrak|widetilde|widehat|overline|underline|boldsymbol|operatorname)\{([^{}]*)\}/g,
    '$2'
  );

  // \left( \right) etc. — sizing modifiers, just drop the command keyword.
  text = text.replace(/\\(left|right)([([{|.])/g, '$2');
  text = text.replace(/\\(left|right)(\\[a-zA-Z]+)/g, '$2');

  // \frac{a}{b} -> a/b
  text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');

  // Accented letters, e.g. \'e or \"{o}. Punctuation-mark commands can appear
  // with or without braces; letter-named ones (\v, \c, ...) only in brace form
  // to avoid misreading unrelated macros like \vec or \ce as accents.
  text = text.replace(/\\(['"`^~])\{?([a-zA-Z])\}?/g, (match, mark: string, letter: string) => {
    return ACCENTS[mark]?.[letter] ?? match;
  });
  text = text.replace(/\\(v|H|c|k|r|u)\{([a-zA-Z])\}/g, (match, mark: string, letter: string) => {
    return ACCENTS[mark]?.[letter] ?? match;
  });

  // Named symbol commands, longest names first so \leq isn't left as "\le" + "q".
  const names = Object.keys(SYMBOL_COMMANDS).sort((a, b) => b.length - a.length);
  const symbolPattern = new RegExp(`\\\\(${names.join('|')})(?![a-zA-Z])`, 'g');
  text = text.replace(symbolPattern, (_, name: string) => SYMBOL_COMMANDS[name]);

  // Escaped punctuation: \% \& \_ \# \{ \}
  text = text.replace(/\\([%&_#{}])/g, '$1');

  // \, \; \! \  (LaTeX spacing) -> space
  text = text.replace(/\\[,;! ]/g, ' ');

  // Any remaining unknown command word, e.g. \citep, \ref -> drop the backslash, keep the word.
  text = text.replace(/\\([a-zA-Z]+)/g, '$1');

  // Leftover stray backslashes.
  text = text.replace(/\\/g, '');

  // Strip math-mode delimiters now that their contents are plain text.
  text = text.replace(/\$\$?/g, '');

  // Drop empty leftover braces, then any remaining brace characters.
  text = text.replace(/\{\}/g, '');
  text = text.replace(/[{}]/g, '');

  // Em/en dashes written as -- or --- in LaTeX source.
  text = text.replace(/---/g, '—');
  text = text.replace(/--/g, '–');

  // Smart quotes written as `` '' or ` '
  text = text.replace(/``/g, '“').replace(/''/g, '”');
  text = text.replace(/`/g, '‘').replace(/'/g, '’');

  return text.replace(/\s+/g, ' ').trim();
}
