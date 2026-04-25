import { ContractError } from '../../utils/errors.js';
import { asPlainObject, isNonEmptyString } from '../../utils/helpers.js';

/**
 * @typedef {Object} SchemaForeignKey
 * @property {string} column                Local column name.
 * @property {string} referencesTable       Target table name.
 * @property {string} referencesColumn      Target column name.
 */

/**
 * @typedef {Object} SchemaJoin
 * @property {string} fromTable
 * @property {string} fromColumn
 * @property {string} toTable
 * @property {string} toColumn
 */

/**
 * @typedef {Object} SchemaColumn
 * @property {string}  name
 * @property {string}  type                  Lower-cased MySQL type with size, e.g. "int", "varchar(50)", "decimal(5,2)", "int unsigned".
 * @property {boolean|null} nullable         True if nullable, false if NOT NULL, null if unknown.
 * @property {string|null}  defaultValue     Raw default literal as it appears in the dump, or null.
 * @property {boolean}      isPrimaryKey
 * @property {boolean}      isForeignKey
 * @property {{ table: string, column: string }|null} references
 */

/**
 * @typedef {Object} SchemaTable
 * @property {string}                          name
 * @property {Record<string, SchemaColumn>}    columns        Keyed by column name.
 * @property {string[]}                        primaryKey     Column names making up the PK (composite-aware).
 * @property {SchemaForeignKey[]}              foreignKeys
 */

/**
 * Internal canonical SchemaContext consumed by the validation layer and
 * (later) the planner / SQL generator.
 *
 * `tables` is keyed by table name for O(1) lookup. `allowedTables` and
 * `allowedColumns` mirror the same data in shapes the validator and the
 * future semantic-layer prefer.
 *
 * @typedef {Object} SchemaContext
 * @property {'mysql'}                              dialect
 * @property {string}                               source           "schema_dump" today; "information_schema" later.
 * @property {string|null}                          database
 * @property {Record<string, SchemaTable>}          tables
 * @property {string[]}                             allowedTables
 * @property {Record<string, string[]>}             allowedColumns
 * @property {SchemaJoin[]}                         allowedJoins
 */

const errorList = (path, message) => [`${path} ${message}`];

const checkColumn = (value, path) => {
  const obj = asPlainObject(value);
  if (!obj) return errorList(path, 'must be an object');
  const errs = [];
  if (!isNonEmptyString(obj.name)) errs.push(...errorList(`${path}.name`, 'must be a non-empty string'));
  if (!isNonEmptyString(obj.type)) errs.push(...errorList(`${path}.type`, 'must be a non-empty string'));
  if (!(obj.nullable === null || typeof obj.nullable === 'boolean')) {
    errs.push(...errorList(`${path}.nullable`, 'must be boolean or null'));
  }
  if (!(obj.defaultValue === null || typeof obj.defaultValue === 'string')) {
    errs.push(...errorList(`${path}.defaultValue`, 'must be string or null'));
  }
  if (typeof obj.isPrimaryKey !== 'boolean') {
    errs.push(...errorList(`${path}.isPrimaryKey`, 'must be a boolean'));
  }
  if (typeof obj.isForeignKey !== 'boolean') {
    errs.push(...errorList(`${path}.isForeignKey`, 'must be a boolean'));
  }
  if (obj.references !== null) {
    const ref = asPlainObject(obj.references);
    if (!ref) {
      errs.push(...errorList(`${path}.references`, 'must be an object or null'));
    } else {
      if (!isNonEmptyString(ref.table)) errs.push(...errorList(`${path}.references.table`, 'must be a non-empty string'));
      if (!isNonEmptyString(ref.column)) errs.push(...errorList(`${path}.references.column`, 'must be a non-empty string'));
    }
  }
  return errs;
};

const checkTable = (value, path) => {
  const obj = asPlainObject(value);
  if (!obj) return errorList(path, 'must be an object');
  const errs = [];
  if (!isNonEmptyString(obj.name)) errs.push(...errorList(`${path}.name`, 'must be a non-empty string'));

  const columns = asPlainObject(obj.columns);
  if (!columns) {
    errs.push(...errorList(`${path}.columns`, 'must be an object'));
  } else {
    for (const [colName, col] of Object.entries(columns)) {
      errs.push(...checkColumn(col, `${path}.columns.${colName}`));
    }
  }

  if (!Array.isArray(obj.primaryKey)) {
    errs.push(...errorList(`${path}.primaryKey`, 'must be an array'));
  } else {
    obj.primaryKey.forEach((c, i) => {
      if (!isNonEmptyString(c)) errs.push(...errorList(`${path}.primaryKey[${i}]`, 'must be a non-empty string'));
    });
  }

  if (!Array.isArray(obj.foreignKeys)) {
    errs.push(...errorList(`${path}.foreignKeys`, 'must be an array'));
  } else {
    obj.foreignKeys.forEach((fk, i) => {
      const fkObj = asPlainObject(fk);
      if (!fkObj) {
        errs.push(...errorList(`${path}.foreignKeys[${i}]`, 'must be an object'));
        return;
      }
      if (!isNonEmptyString(fkObj.column)) errs.push(...errorList(`${path}.foreignKeys[${i}].column`, 'must be a non-empty string'));
      if (!isNonEmptyString(fkObj.referencesTable)) errs.push(...errorList(`${path}.foreignKeys[${i}].referencesTable`, 'must be a non-empty string'));
      if (!isNonEmptyString(fkObj.referencesColumn)) errs.push(...errorList(`${path}.foreignKeys[${i}].referencesColumn`, 'must be a non-empty string'));
    });
  }
  return errs;
};

/**
 * Runtime validator for SchemaContext. Returns the input on success;
 * throws ContractError with aggregated messages on failure.
 *
 * Beyond shape, asserts the cross-references:
 *   - every entry in `allowedTables` exists in `tables`
 *   - every column listed in `allowedColumns[t]` exists in `tables[t].columns`
 *
 * @param {unknown} value
 * @returns {SchemaContext}
 */
export const assertSchemaContext = (value) => {
  const errs = [];
  const obj = asPlainObject(value);
  if (!obj) {
    throw new ContractError('Contract violation in SchemaContext: 1 error(s)', {
      contract: 'SchemaContext',
      errors: ['SchemaContext must be an object'],
    });
  }

  if (obj.dialect !== 'mysql') errs.push('SchemaContext.dialect must be "mysql"');
  if (!isNonEmptyString(obj.source)) errs.push('SchemaContext.source must be a non-empty string');
  if (!(obj.database === null || isNonEmptyString(obj.database))) {
    errs.push('SchemaContext.database must be a non-empty string or null');
  }

  const tables = asPlainObject(obj.tables);
  if (!tables) {
    errs.push('SchemaContext.tables must be an object');
  } else {
    for (const [tName, t] of Object.entries(tables)) {
      errs.push(...checkTable(t, `SchemaContext.tables.${tName}`));
    }
  }

  if (!Array.isArray(obj.allowedTables)) {
    errs.push('SchemaContext.allowedTables must be an array');
  } else {
    obj.allowedTables.forEach((t, i) => {
      if (!isNonEmptyString(t)) {
        errs.push(`SchemaContext.allowedTables[${i}] must be a non-empty string`);
      } else if (tables && !Object.prototype.hasOwnProperty.call(tables, t)) {
        errs.push(`SchemaContext.allowedTables[${i}] "${t}" not found in tables`);
      }
    });
  }

  const allowedColumns = asPlainObject(obj.allowedColumns);
  if (!allowedColumns) {
    errs.push('SchemaContext.allowedColumns must be an object');
  } else {
    for (const [tName, cols] of Object.entries(allowedColumns)) {
      if (!Array.isArray(cols)) {
        errs.push(`SchemaContext.allowedColumns.${tName} must be an array`);
        continue;
      }
      const tableCols = tables && asPlainObject(tables[tName])
        ? asPlainObject(asPlainObject(tables[tName]).columns)
        : null;
      cols.forEach((c, i) => {
        if (!isNonEmptyString(c)) {
          errs.push(`SchemaContext.allowedColumns.${tName}[${i}] must be a non-empty string`);
          return;
        }
        if (tableCols && !Object.prototype.hasOwnProperty.call(tableCols, c)) {
          errs.push(`SchemaContext.allowedColumns.${tName}[${i}] "${c}" not found in tables.${tName}.columns`);
        }
      });
    }
  }

  if (!Array.isArray(obj.allowedJoins)) {
    errs.push('SchemaContext.allowedJoins must be an array');
  } else {
    obj.allowedJoins.forEach((j, i) => {
      const jo = asPlainObject(j);
      if (!jo) {
        errs.push(`SchemaContext.allowedJoins[${i}] must be an object`);
        return;
      }
      for (const k of ['fromTable', 'fromColumn', 'toTable', 'toColumn']) {
        if (!isNonEmptyString(jo[k])) {
          errs.push(`SchemaContext.allowedJoins[${i}].${k} must be a non-empty string`);
        }
      }
    });
  }

  if (errs.length) {
    throw new ContractError(`Contract violation in SchemaContext: ${errs.length} error(s)`, {
      contract: 'SchemaContext',
      errors: errs,
    });
  }

  return /** @type {SchemaContext} */ (value);
};
