/**
 * MySQL dump parser.
 *
 * Strategy:
 *   1. Strip MySQL conditional comments (`/* ... *\/`) and `--` line
 *      comments. Keeps string literals intact (those rarely contain `/*`
 *      in dump output).
 *   2. Walk the cleaned text and locate every `CREATE TABLE` block. Use
 *      a paren-depth counter (string-aware) to find the matching closing
 *      `)` so multiline / nested-paren bodies are handled correctly.
 *   3. Split each block's body into top-level entries (paren-depth-aware
 *      comma split). Each entry is a column, primary key, foreign key,
 *      or an index/constraint we ignore.
 *   4. Parse columns (name, type with size + signed/unsigned, nullable,
 *      default, inline PK), composite primary keys (with prefix-length
 *      stripping), and foreign keys.
 *
 * The parser is NOT a general SQL parser. It only handles the shape of
 * `mysqldump` output. Other dialects and hand-written DDL may not parse.
 */

/** @typedef {import('./schema.types.js').SchemaTable} SchemaTable */
/** @typedef {import('./schema.types.js').SchemaColumn} SchemaColumn */
/** @typedef {import('./schema.types.js').SchemaForeignKey} SchemaForeignKey */
/** @typedef {import('./schema.types.js').SchemaJoin} SchemaJoin */

const TYPE_MODIFIERS = /^(?:unsigned|signed|zerofill)$/i;

/**
 * Strip C-style block comments and `--` line comments from a SQL dump.
 * Does NOT attempt to be string-literal-aware for `/* *\/` because
 * mysqldump output never embeds those inside literals.
 *
 * @param {string} sql
 * @returns {string}
 */
const stripComments = (sql) => {
  // Remove /* ... */ (including MySQL conditional /*! ... */ variants).
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove `-- ...` line comments. Keep the newline so line numbers stay
  // somewhat aligned for downstream debugging.
  out = out.replace(/^\s*--[^\n]*$/gm, '');
  return out;
};

/**
 * Skip over a quoted string starting at `i` (which points at the
 * opening quote). Returns the index just past the closing quote.
 * Handles backslash escapes and the SQL '' (doubled quote) escape.
 *
 * @param {string} sql
 * @param {number} i
 * @returns {number}
 */
const skipQuoted = (sql, i) => {
  const quote = sql[i];
  i++;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '\\' && i + 1 < sql.length) {
      i += 2;
      continue;
    }
    if (c === quote) {
      // Doubled quote escape: 'don''t' inside a single-quoted string.
      if (quote !== '`' && sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return i;
};

/**
 * Find the matching `)` for the `(` at `openIdx`, accounting for nested
 * parens and string literals. Returns the index of the matching `)`,
 * or -1 if unbalanced.
 *
 * @param {string} sql
 * @param {number} openIdx
 * @returns {number}
 */
const findMatchingParen = (sql, openIdx) => {
  let depth = 1;
  let i = openIdx + 1;
  while (i < sql.length && depth > 0) {
    const ch = sql[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(sql, i);
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
};

/**
 * Locate each `CREATE TABLE \`name\` (...)` block in the dump.
 * Returns name + body (the contents between the outermost parens).
 *
 * @param {string} sql
 * @returns {Array<{ name: string, body: string }>}
 */
const extractCreateTableBlocks = (sql) => {
  const blocks = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    const openIdx = m.index + m[0].length - 1; // index of the `(`
    const closeIdx = findMatchingParen(sql, openIdx);
    if (closeIdx === -1) continue;
    const body = sql.substring(openIdx + 1, closeIdx);
    blocks.push({ name, body });
  }
  return blocks;
};

/**
 * Split a CREATE TABLE body into its top-level entries (columns,
 * constraints, indexes), respecting parens and quotes.
 *
 * @param {string} body
 * @returns {string[]}
 */
const splitTableEntries = (body) => {
  /** @type {string[]} */
  const entries = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(body, i);
      continue;
    }
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      entries.push(body.substring(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  const last = body.substring(start).trim();
  if (last) entries.push(last);
  return entries;
};

/**
 * Pull the column-name list out of a `(\`a\`, \`b\`(200), ...)` body.
 * Strips backticks and any trailing prefix-length specifier.
 *
 * @param {string} inner
 * @returns {string[]}
 */
const extractColumnList = (inner) => {
  const cols = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuoted(inner, i);
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      cols.push(inner.substring(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  cols.push(inner.substring(start).trim());
  return cols
    .map((c) => {
      const m = /^`([^`]+)`/.exec(c);
      return m ? m[1] : c.replace(/[`(].*$/, '').trim();
    })
    .filter(Boolean);
};

/**
 * Parse a single column entry. Returns the partial column record plus
 * an `inlinePrimaryKey` flag (true if the column carries `PRIMARY KEY`
 * inline).
 *
 * @param {string} entry
 * @returns {{ kind: 'column', column: SchemaColumn, inlinePrimaryKey: boolean }|null}
 */
const parseColumnEntry = (entry) => {
  const m = /^`([^`]+)`\s+(\S+(?:\s+(?:unsigned|signed|zerofill))*)([\s\S]*)$/i.exec(entry);
  if (!m) return null;
  const [, name, rawType, rest] = m;
  const type = rawType.toLowerCase().split(/\s+/).filter((tok) => {
    // Keep base type token; keep modifiers we recognize.
    return tok.length > 0;
  }).join(' ');

  const restUpper = rest.toUpperCase();
  const isNotNull = /\bNOT\s+NULL\b/.test(restUpper);
  const explicitNull = /\bDEFAULT\s+NULL\b/.test(restUpper) || /\b(?<!NOT\s)NULL\b/.test(restUpper);
  /** @type {boolean|null} */
  let nullable = null;
  if (isNotNull) nullable = false;
  else if (explicitNull) nullable = true;
  // If neither, leave null (unknown).

  /** @type {string|null} */
  let defaultValue = null;
  const dm = /\bDEFAULT\s+(?:'((?:[^'\\]|\\.|'')*?)'|"((?:[^"\\]|\\.|"")*?)"|(\S+))/i.exec(rest);
  if (dm) defaultValue = dm[1] ?? dm[2] ?? dm[3] ?? null;
  if (defaultValue && defaultValue.toUpperCase() === 'NULL') defaultValue = null;

  const inlinePrimaryKey = /\bPRIMARY\s+KEY\b/i.test(rest);

  return {
    kind: 'column',
    column: {
      name,
      type,
      nullable,
      defaultValue,
      isPrimaryKey: false,
      isForeignKey: false,
      references: null,
    },
    inlinePrimaryKey,
  };
};

/**
 * @param {string} entry
 * @returns {{ kind: 'primaryKey', columns: string[] }|null}
 */
const parsePrimaryKeyEntry = (entry) => {
  const m = /^PRIMARY\s+KEY\s*\(([\s\S]+)\)\s*$/i.exec(entry);
  if (!m) return null;
  return { kind: 'primaryKey', columns: extractColumnList(m[1]) };
};

/**
 * Parse a top-level FOREIGN KEY entry (with or without leading
 * CONSTRAINT name). Returns null for CHECK / non-FK constraints.
 *
 * @param {string} entry
 * @returns {{ kind: 'foreignKey', columns: string[], referencesTable: string, referencesColumns: string[] }|null}
 */
const parseForeignKeyEntry = (entry) => {
  const re = /(?:^|^CONSTRAINT\s+`[^`]+`\s+)FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+`([^`]+)`\s*\(([^)]+)\)/i;
  const m = re.exec(entry);
  if (!m) return null;
  return {
    kind: 'foreignKey',
    columns: extractColumnList(m[1]),
    referencesTable: m[2],
    referencesColumns: extractColumnList(m[3]),
  };
};

/**
 * Classify a single body entry into the structures we care about.
 * Indexes (`KEY`, `UNIQUE KEY`, `FULLTEXT KEY`), CHECK constraints,
 * and any other unknown directive return null and are ignored.
 *
 * @param {string} entry
 * @returns {ReturnType<typeof parseColumnEntry> | ReturnType<typeof parsePrimaryKeyEntry> | ReturnType<typeof parseForeignKeyEntry> | null}
 */
const classifyEntry = (entry) => {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('`')) return parseColumnEntry(trimmed);

  const upper = trimmed.toUpperCase();
  if (upper.startsWith('PRIMARY KEY')) return parsePrimaryKeyEntry(trimmed);
  if (upper.startsWith('FOREIGN KEY')) return parseForeignKeyEntry(trimmed);
  if (upper.startsWith('CONSTRAINT')) return parseForeignKeyEntry(trimmed);
  return null;
};

/**
 * Build a SchemaTable from a CREATE TABLE block.
 *
 * @param {{ name: string, body: string }} block
 * @returns {SchemaTable}
 */
const parseTableBlock = ({ name, body }) => {
  /** @type {Record<string, SchemaColumn>} */
  const columns = {};
  /** @type {string[]} */
  let primaryKey = [];
  /** @type {SchemaForeignKey[]} */
  const foreignKeys = [];

  for (const raw of splitTableEntries(body)) {
    const e = classifyEntry(raw);
    if (!e) continue;

    if (e.kind === 'column') {
      columns[e.column.name] = { ...e.column };
      if (e.inlinePrimaryKey && primaryKey.length === 0) {
        primaryKey = [e.column.name];
      }
    } else if (e.kind === 'primaryKey') {
      primaryKey = e.columns;
    } else if (e.kind === 'foreignKey') {
      e.columns.forEach((col, idx) => {
        const refCol = e.referencesColumns[idx] ?? e.referencesColumns[0];
        foreignKeys.push({
          column: col,
          referencesTable: e.referencesTable,
          referencesColumn: refCol,
        });
      });
    }
  }

  for (const colName of primaryKey) {
    if (columns[colName]) columns[colName].isPrimaryKey = true;
  }
  for (const fk of foreignKeys) {
    if (columns[fk.column]) {
      columns[fk.column].isForeignKey = true;
      columns[fk.column].references = {
        table: fk.referencesTable,
        column: fk.referencesColumn,
      };
    }
  }

  return { name, columns, primaryKey, foreignKeys };
};

/**
 * Parse a full MySQL dump into a normalized intermediate form. The
 * provider wraps this with dialect / source / database fields to
 * produce the final SchemaContext.
 *
 * @param {string} sql
 * @returns {{ tables: Record<string, SchemaTable>, allowedTables: string[], allowedColumns: Record<string, string[]>, allowedJoins: SchemaJoin[] }}
 */
export const parseSchemaDump = (sql) => {
  const cleaned = stripComments(sql);
  const blocks = extractCreateTableBlocks(cleaned);

  /** @type {Record<string, SchemaTable>} */
  const tables = {};
  /** @type {string[]} */
  const allowedTables = [];
  /** @type {Record<string, string[]>} */
  const allowedColumns = {};
  /** @type {SchemaJoin[]} */
  const allowedJoins = [];

  for (const block of blocks) {
    const t = parseTableBlock(block);
    tables[t.name] = t;
    allowedTables.push(t.name);
    allowedColumns[t.name] = Object.keys(t.columns);
    for (const fk of t.foreignKeys) {
      allowedJoins.push({
        fromTable: t.name,
        fromColumn: fk.column,
        toTable: fk.referencesTable,
        toColumn: fk.referencesColumn,
      });
    }
  }

  return { tables, allowedTables, allowedColumns, allowedJoins };
};
