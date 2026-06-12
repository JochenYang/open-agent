/**
 * python.ts — Parser plugin for Python
 *
 * Handles: .py
 * Capabilities:
 *   - extractImports: import / from ... import / relative imports (.)
 *   - parseTypeDefs:  class definitions (with dataclass/TypedDict support)
 *
 * Python import resolution note:
 *   Python uses package/module paths, not file paths. A local import like
 *   "from myapp.utils import foo" maps to myapp/utils.py or myapp/utils/__init__.py.
 *   We treat any import NOT starting with "." as potentially local if it matches
 *   a project directory — the normalizeImportPath method handles this mapping.
 */

import path from "path"
import type { Parser, ImportDecl, TypeDef, TypeField } from "./types"

// ── Import extraction ──

/** import foo / import foo.bar */
const IMPORT_RE = /^import\s+([.\w]+)/gm
/** from foo import bar / from .foo import bar / from .. import bar */
const FROM_IMPORT_RE = /^from\s+([.\w]+)\s+import\s+([.\w,\s]+)/gm

/** Extract import declarations from Python source content. */
function extractImports(content: string): ImportDecl[] {
  const imports: ImportDecl[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  // Step 1: scan "import X" statements
  const importRe = new RegExp(IMPORT_RE.source, IMPORT_RE.flags)
  while ((match = importRe.exec(content)) !== null) {
    const rawPath = match[1]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `${rawPath}:${lineNum}`
    if (seen.has(key)) continue
    seen.add(key)
    imports.push({
      rawPath,
      isLocal: rawPath.startsWith("."),
      line: lineNum,
    })
  }

  // Step 2: scan "from X import Y" statements
  const fromRe = new RegExp(FROM_IMPORT_RE.source, FROM_IMPORT_RE.flags)
  while ((match = fromRe.exec(content)) !== null) {
    const rawPath = match[1]
    const symbolsStr = match[2]
    const lineNum = content.slice(0, match.index).split("\n").length
    const key = `${rawPath}:${lineNum}`
    if (seen.has(key)) continue
    seen.add(key)

    const symbols = symbolsStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    imports.push({
      rawPath,
      isLocal: rawPath.startsWith("."),
      symbols,
      line: lineNum,
    })
  }

  return imports
}

// ── Type definition parsing ──

/** class Foo: / class Foo(Base): / @dataclass class Foo: */
const CLASS_RE = /(?:^|\n)(class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:)/g

/** Extract class definitions as type definitions. */
function parseTypeDefs(content: string, filePath: string): TypeDef[] {
  const defs: TypeDef[] = []
  let match: RegExpExecArray | null
  const classRe = new RegExp(CLASS_RE.source, CLASS_RE.flags)

  while ((match = classRe.exec(content)) !== null) {
    const name = match[2]
    const bases = match[3] ? match[3].split(",").map((s) => s.trim()) : []
    const startLine = content.slice(0, match.index).split("\n").length + 1

    // Step 3: determine if class is "exported" (not starting with _)
    const isExported = !name.startsWith("_")

    // Step 4: determine kind from base classes
    let kind: TypeDef["kind"] = "class"
    if (bases.some((b) => b === "TypedDict" || b === "NamedTuple" || b === "BaseModel")) {
      kind = "interface"
    }
    if (bases.some((b) => b === "Enum" || b === "StrEnum" || b === "IntEnum")) {
      kind = "enum"
    }

    // Step 5: extract class body fields (simplified — indented block)
    const fields = extractPythonClassFields(content, match.index + match[0].length, startLine)

    defs.push({ name, kind, fields, line: startLine, exported: isExported })
  }

  return defs
}

/** Extract fields from a Python class body (indented block). */
function extractPythonClassFields(content: string, bodyStart: number, baseLine: number): TypeField[] {
  const fields: TypeField[] = []
  const lines = content.slice(bodyStart).split("\n")

  // Class body ends when indentation returns to zero or less
  let inBody = false
  let bodyIndent = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue

    const currentIndent = line.length - trimmed.length

    if (!inBody) {
      // First non-empty line defines body indentation
      if (currentIndent > 0) {
        inBody = true
        bodyIndent = currentIndent
      } else {
        break // Empty class or no indented body
      }
    }

    // Body ends when indentation drops below class body level
    if (currentIndent < bodyIndent) break

    // Only parse top-level fields (at class body indent level)
    if (currentIndent !== bodyIndent) continue

    // Step 6: match typed fields — name: type or name: type = default
    const typedFieldMatch = trimmed.match(/^(\w+)\s*:\s*([^=#\n]+?)(?:\s*=\s*(.+?))?(?:\s*#.*)?$/)
    if (typedFieldMatch) {
      const name = typedFieldMatch[1]
      if (name.startsWith("_") && !name.startsWith("__")) continue // skip private
      fields.push({
        name,
        optional: typedFieldMatch[3] !== undefined, // has default = optional
        type: typedFieldMatch[2].trim(),
        line: baseLine + i,
      })
      continue
    }

    // Step 7: match enum members — NAME = value
    const enumMatch = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/)
    if (enumMatch) {
      fields.push({
        name: enumMatch[1],
        optional: false,
        type: "enum-member",
        line: baseLine + i,
      })
    }
  }

  return fields
}

// ── Path normalization ──

function isLocalImport(rawPath: string): boolean {
  // Relative imports always start with "."
  if (rawPath.startsWith(".")) return true
  // Absolute imports: treated as potentially local — normalizeImportPath will verify
  return false
}

function normalizeImportPath(rawPath: string, fromFile: string, srcDir: string): string | null {
  let modulePath: string

  if (rawPath.startsWith(".")) {
    // Step 8: relative import — resolve from importing file's package
    const filePackage = fromFile.replace(/\\/g, "/").replace(/\/__init__\.py$/, "").replace(/\/[^/]+\.py$/, "")
    const dots = rawPath.match(/^(\.+)/)?.[1].length ?? 1
    let base = filePackage
    for (let i = 1; i < dots; i++) {
      base = base.replace(/\/[^/]+$/, "")
    }
    const rest = rawPath.slice(dots)
    modulePath = rest ? `${base}/${rest}` : base
  } else {
    // Step 9: absolute import — convert dotted path to file path
    modulePath = rawPath.replace(/\./g, "/")
  }

  // Verify it resolves within srcDir
  const relative = path.relative(srcDir, path.resolve(srcDir, modulePath))
  if (relative.startsWith("..")) return null
  return relative.replace(/\\/g, "/")
}

// ── Export parser instance ──

export const pythonParser: Parser = {
  name: "Python",
  extensions: ["py"],
  extractImports,
  parseTypeDefs,
  isLocalImport,
  normalizeImportPath,
}