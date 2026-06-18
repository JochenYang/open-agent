// @bun
// Forge plugin — minimal tools for the Forge primary agent workflow.
//
// Why this exists:
// 1. The previous memory plugin was deleted due to instability issues.
// 2. We need a thin set of tools that fit forge's actual workflow:
//    - punchcard:   T1/T1.1 work-item tracking (replaces memory plugin's `task` tool)
//    - forge-check: lightweight stage checkpoints (no FTS5, no auto-dream)
//
// Subagent dispatch is handled directly by the upstream `task` tool.
// Previously we had a `dispatcher` pre-flight validator, but it created a
// two-step pattern (dispatcher → task) that the LLM often simulated without
// emitting the real `task` call. Now we use `task` directly in a single
// tool_use, matching opencode's native behavior.
//
// Storage layout (all under ~/.config/opencode/forge/):
//   punchcard/<sessionId>/<TID>/progress.md   — frontmatter + body, one file per work-item
//   checks/<sessionId>/<timestamp>.md         — one file per checkpoint
//
// No memory, no dream, no FTS5 — kept simple on purpose.

import path from "path"
import fs from "fs"
import os from "os"
import { createHash } from "crypto"
import { tool } from "@opencode-ai/plugin"

const FORGE_ROOT = path.join(os.homedir(), ".config", "opencode", "forge")

function projectHash(dir) {
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

function projectDir(ctx) {
  return ctx.directory ?? ctx.worktree ?? process.cwd()
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf-8")
  } catch {
    return undefined
  }
}

function writeText(p, content) {
  ensureDir(path.dirname(p))
  fs.writeFileSync(p, content, "utf-8")
}

function listDirs(parent) {
  try {
    return fs
      .readdirSync(parent, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

function uniq(s) {
  return Array.from(new Set(s))
}

function parseFrontmatter(block) {
  const out = {}
  const lines = block.split("\n")
  for (const raw of lines) {
    const m = raw.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
  }
  return out
}

const TID_RE = /^T(\d+)(?:\.(\d+))*$/

// === punchcard: T1/T1.1 work-item tracking ===

const PUNCHCARD_OPS = [
  "create",
  "list",
  "get",
  "start",
  "block",
  "unblock",
  "done",
  "abandon",
  "rename",
]

function punchcardDir(project, sid) {
  return path.join(FORGE_ROOT, "punchcard", project, sid)
}
function punchcardItemDir(project, sid, tid) {
  return path.join(punchcardDir(project, sid), tid)
}
function punchcardItemFile(project, sid, tid) {
  return path.join(punchcardItemDir(project, sid, tid), "progress.md")
}

function nextTid(project, sid, parentId) {
  const records = punchcardList(project, sid)
  if (!parentId) {
    const used = new Set()
    for (const r of records) {
      if (r.parentId) continue
      const m = r.id.match(/^T(\d+)$/)
      if (m) used.add(Number(m[1]))
    }
    for (let i = 1; i < Number.MAX_SAFE_INTEGER; i++) {
      if (!used.has(i)) return `T${i}`
    }
  } else {
    const used = new Set()
    const childRe = new RegExp(`^${parentId.replace(/\./g, "\\.")}\\.(\\d+)$`)
    for (const r of records) {
      const m = r.id.match(childRe)
      if (m) used.add(Number(m[1]))
    }
    for (let i = 1; i < Number.MAX_SAFE_INTEGER; i++) {
      if (!used.has(i)) return `${parentId}.${i}`
    }
  }
  throw new Error("punchcard: TID space exhausted")
}

function punchcardRead(project, sid, tid) {
  const file = punchcardItemFile(project, sid, tid)
  const text = readText(file)
  if (!text) return undefined
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return undefined
  const meta = parseFrontmatter(m[1])
  return {
    id: tid,
    summary: meta.summary ?? "",
    status: meta.status ?? "open",
    parentId: meta.parent_id || null,
    createdAt: Number(meta.created_at ?? 0),
    updatedAt: Number(meta.updated_at ?? 0),
    body: m[2].trim(),
    path: file,
  }
}

function punchcardList(project, sid) {
  const items = []
  for (const tid of listDirs(punchcardDir(project, sid))) {
    if (!TID_RE.test(tid)) continue
    const r = punchcardRead(project, sid, tid)
    if (r) items.push(r)
  }
  items.sort((a, b) => a.id.localeCompare(b.id))
  return items
}

function punchcardRender(item) {
  return [
    "---",
    `id: ${item.id}`,
    `summary: ${item.summary}`,
    `status: ${item.status}`,
    `parent_id: ${item.parentId ?? ""}`,
    `created_at: ${item.createdAt}`,
    `updated_at: ${item.updatedAt}`,
    "---",
    "",
    item.body ?? "",
  ].join("\n")
}

function punchcardWrite(project, sid, item) {
  writeText(punchcardItemFile(project, sid, item.id), punchcardRender(item))
}

const PUNCHCARD_TRANSITIONS = {
  start: { from: ["open", "blocked"], to: "in_progress" },
  block: { from: ["in_progress", "open"], to: "blocked" },
  unblock: { from: ["blocked"], to: "open" },
  done: { from: ["in_progress", "open"], to: "done" },
  abandon: { from: ["done"], to: "abandoned", reverse: true },
}

const punchcardTool = tool({
  description:
    "T1/T1.1 work-item tracking. Operations: create | list | get | start | block | unblock | done | abandon | rename. Persists to ~/.config/opencode/forge/punchcard/. Use this to track each plan task with an explicit TID that subagent dispatch can reference. NEVER confuse with the upstream `task` tool — `task` dispatches subagents, `punchcard` tracks local work-item state.",
  args: {
    operation: tool.schema
      .enum(PUNCHCARD_OPS)
      .describe("create | list | get | start | block | unblock | done | abandon | rename"),
    session_id: tool.schema.string().describe("Session id (defaults to current session)").optional(),
    summary: tool.schema.string().describe("Task summary (required for create/rename)").optional(),
    id: tool.schema
      .string()
      .describe("TID like T1, T1.1 — required for get/start/block/unblock/done/abandon/rename")
      .optional(),
    parent_id: tool.schema.string().describe("Parent TID for sub-tasks (optional, for create)").optional(),
    body: tool.schema.string().describe("Initial body content (optional, for create)").optional(),
    reason: tool.schema.string().describe("Reason / event summary (optional, for transitions)").optional(),
  },
  execute: async (args, ctx) => {
    const op = String(args.operation ?? "")
    const sid = String(args.session_id ?? ctx.sessionID ?? "default")
    const project = projectHash(projectDir(ctx))
    try {
      if (op === "create") {
        const summary = String(args.summary ?? "").trim()
        if (!summary) return "punchcard.create: summary is required"
        const parentId = args.parent_id ? String(args.parent_id) : undefined
        const body = args.body ? String(args.body) : ""
        const tid = nextTid(project, sid, parentId)
        const now = Date.now()
        const item = {
          id: tid,
          summary,
          status: "open",
          parentId: parentId ?? null,
          createdAt: now,
          updatedAt: now,
          body,
        }
        punchcardWrite(project, sid, item)
        return `Created ${tid} (open) in project ${project} session ${sid}: ${summary}\nFile: ${punchcardItemFile(project, sid, tid)}`
      }
      if (op === "list") {
        const items = punchcardList(project, sid)
        if (items.length === 0) return `No punchcard items in project ${project} session ${sid}.`
        const lines = items.map((it) => `${it.id} ${it.status} — ${it.summary}`)
        return `Punchcard (${project}/${sid}, ${items.length} items):\n\n${lines.join("\n")}`
      }
      if (op === "get") {
        const id = String(args.id ?? "")
        if (!id) return "punchcard.get: id is required"
        const it = punchcardRead(project, sid, id)
        if (!it) return `No punchcard item ${id} in project ${project} session ${sid}.`
        return [
          `${it.id} (${it.status}): ${it.summary}`,
          `Parent: ${it.parentId ?? "(root)"}`,
          `Created: ${new Date(it.createdAt).toISOString()}`,
          `Updated: ${new Date(it.updatedAt).toISOString()}`,
          `File: ${it.path}`,
          "",
          "Body:",
          it.body || "(empty)",
        ].join("\n")
      }
      if (op === "rename") {
        const id = String(args.id ?? "")
        const summary = String(args.summary ?? "").trim()
        if (!id || !summary) return "punchcard.rename: id and summary are required"
        const it = punchcardRead(project, sid, id)
        if (!it) return `No punchcard item ${id} in project ${project} session ${sid}.`
        it.summary = summary
        it.updatedAt = Date.now()
        punchcardWrite(project, sid, it)
        return `Renamed ${id}: "${summary}"`
      }
      if (["start", "block", "unblock", "done", "abandon"].includes(op)) {
        const id = String(args.id ?? "")
        if (!id) return `punchcard.${op}: id is required`
        const it = punchcardRead(project, sid, id)
        if (!it) return `No punchcard item ${id} in project ${project} session ${sid}.`
        const rule = PUNCHCARD_TRANSITIONS[op]
        if (rule.reverse) {
          if (it.status !== rule.from[0]) {
            return `punchcard.${op}: cannot abandon a ${it.status} item (only done items can be abandoned)`
          }
          it.status = rule.to
        } else {
          if (!rule.from.includes(it.status)) {
            return `punchcard.${op}: illegal transition from ${it.status} (allowed from: ${rule.from.join(", ")})`
          }
          it.status = rule.to
        }
        it.updatedAt = Date.now()
        punchcardWrite(project, sid, it)
        const reason = args.reason ? String(args.reason) : undefined
        return `${id} → ${it.status}${reason ? ` (${reason})` : ""}`
      }
      return `punchcard: unknown operation "${op}". Available: ${PUNCHCARD_OPS.join(", ")}.`
    } catch (e) {
      return `punchcard.${op || "?"} error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

// === forge-check: lightweight stage checkpoints ===

const CHECK_OPS = ["create", "list", "get", "latest"]

function checkDir(project, sid) {
  return path.join(FORGE_ROOT, "checks", project, sid)
}

function listChecks(project, sid) {
  const out = []
  for (const f of (() => {
    try {
      return fs
        .readdirSync(checkDir(project, sid), { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".md"))
        .map((d) => d.name)
    } catch {
      return []
    }
  })()) {
    const full = path.join(checkDir(project, sid), f)
    const m = f.match(/^(\d+)-(.+)\.md$/)
    if (!m) continue
    const text = readText(full) ?? ""
    const head = (text.split("\n")[0] ?? "").replace(/^#\s*/, "").trim()
    out.push({ file: f, ts: Number(m[1]), stage: m[2], title: head || m[2], path: full })
  }
  out.sort((a, b) => b.ts - a.ts)
  return out
}

const forgeCheckTool = tool({
  description:
    "Lightweight stage checkpoint. Snapshots a milestone in the current session (e.g., 'plan-complete', 'task-1-done'). Persists to ~/.config/opencode/forge/checks/. Use this to record progress so a resumed session can pick up where it left off.",
  args: {
    operation: tool.schema.enum(CHECK_OPS).describe("create | list | get | latest"),
    session_id: tool.schema.string().describe("Session id (defaults to current session)").optional(),
    stage: tool.schema
      .string()
      .describe("Stage name (slug, e.g., 'plan-complete', 'task-1-done', 'merge-ready')")
      .optional(),
    summary: tool.schema.string().describe("Short title for the checkpoint (used as H1)").optional(),
    details: tool.schema.string().describe("Optional body content (markdown supported)").optional(),
    file: tool.schema.string().describe("Checkpoint filename (for operation=get)").optional(),
  },
  execute: async (args, ctx) => {
    const op = String(args.operation ?? "")
    const sid = String(args.session_id ?? ctx.sessionID ?? "default")
    const project = projectHash(projectDir(ctx))
    try {
      if (op === "create") {
        const stage = String(args.stage ?? "").trim()
        if (!stage) return "forge-check.create: stage is required (e.g., 'plan-complete')"
        if (!/^[a-z0-9][a-z0-9-]*$/.test(stage)) {
          return `forge-check.create: stage must be kebab-case slug (got "${stage}")`
        }
        const summary = String(args.summary ?? stage).trim()
        const details = String(args.details ?? "")
        const ts = Date.now()
        const file = path.join(checkDir(project, sid), `${ts}-${stage}.md`)
        const content = [
          `# ${summary}`,
          "",
          `- created_at: ${new Date(ts).toISOString()}`,
          `- project: ${project}`,
          `- session_id: ${sid}`,
          `- stage: ${stage}`,
          "",
          "---",
          "",
          details,
        ].join("\n")
        writeText(file, content)
        return `Checkpoint recorded: ${stage} (project ${project})\n  ${file}`
      }
      if (op === "list") {
        const items = listChecks(project, sid)
        if (items.length === 0) return `No checkpoints in project ${project} session ${sid}.`
        const lines = items.map((it) => {
          const when = new Date(it.ts).toISOString().slice(0, 16).replace("T", " ")
          return `${when}  ${it.stage.padEnd(20)}  ${it.title}`
        })
        return `Checkpoints (${project}/${sid}, ${items.length} items):\n\n${lines.join("\n")}`
      }
      if (op === "latest") {
        const items = listChecks(project, sid)
        if (items.length === 0) return `No checkpoints in project ${project} session ${sid}.`
        const it = items[0]
        const text = readText(it.path) ?? ""
        return `Latest checkpoint (${it.stage}, ${new Date(it.ts).toISOString()}):\n\n${text}\n\nFile: ${it.path}`
      }
      if (op === "get") {
        const file = String(args.file ?? "")
        if (!file) return "forge-check.get: file is required (e.g., '1700000000-plan-complete.md')"
        const full = path.join(checkDir(project, sid), file)
        const text = readText(full)
        if (!text) return `No checkpoint file: ${full}`
        return text + `\n\nFile: ${full}`
      }
      return `forge-check: unknown operation "${op}". Available: ${CHECK_OPS.join(", ")}.`
    } catch (e) {
      return `forge-check.${op || "?"} error: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

// === forge-skill: explicit skill loader + subagent injector ===
//
// Why this exists:
// - The upstream `skill` tool loads SKILL.md content on demand, but the model
//   tends to *mention* skill names in its thinking without actually calling it.
// - When dispatching subagents, the orchestrator is supposed to inject relevant
//   skill content into the subagent prompt (per forge:subagent SKILL.md), but
//   this step is easy to skip.
// - This tool does BOTH: it forces the model to invoke a tool (not just talk
//   about it), and provides a `mode=inject` variant that returns a formatted
//   block ready to paste into a subagent prompt.
//
// NO conflict with the upstream `skill` tool: different id, both coexist.
//   This tool's `mode=load` returns content with a clear "loaded" marker;
//   `mode=inject` is a NEW capability upstream doesn't have.

const FORGE_SKILL_SEARCH_DIRS = [
  path.join(os.homedir(), ".config", "opencode", "forge-skills"),
  path.join(os.homedir(), ".config", "opencode", "skills"),
  path.join(os.homedir(), ".config", "opencode", "agents"),
  path.join(os.homedir(), ".claude", "skills"),
  path.join(os.homedir(), ".agents", "skills"),
]

function findForgeSkill(name) {
  // Skill name may be "forge:brainstorm" (namespaced) or "brainstorm" (bare).
  // The directory is always the last segment after the colon.
  const dirName = String(name).split(":").pop()
  if (!dirName) return undefined

  for (const root of FORGE_SKILL_SEARCH_DIRS) {
    // Exact match: <root>/<dirName>/SKILL.md
    let candidate = path.join(root, dirName, "SKILL.md")
    if (fs.existsSync(candidate)) return candidate
    // Try with namespace prefix: <root>/<namespace>/<dirName>/SKILL.md
    // (e.g., for "forge:brainstorm" the path might be <root>/forge/brainstorm/SKILL.md)
    const namespace = String(name).includes(":") ? String(name).split(":")[0] : null
    if (namespace && namespace !== dirName) {
      candidate = path.join(root, namespace, dirName, "SKILL.md")
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const forgeSkillTool = tool({
  description:
    "MUST call this to load a forge skill's full SKILL.md content (not just the name from <available_skills>). Without this call, you only have the skill's description — NOT the workflow. Use mode='load' to load into your own context, or mode='inject' to get a formatted block ready to paste into a subagent prompt you dispatch via the `task` tool. NEVER confuse with the upstream `skill` tool — `skill` loads too, but `forge-skill` adds the inject-for-subagent capability and makes the loading action explicit/auditable.",
  args: {
    name: tool.schema
      .string()
      .describe("Skill name (e.g., 'forge:brainstorm', 'forge:subagent'). The part after the last ':' is used as the directory name to look up SKILL.md."),
    mode: tool.schema
      .enum(["load", "inject"])
      .describe("'load' (default): return the SKILL.md content for your own context. 'inject': return a formatted block ready to paste into a subagent prompt.")
      .optional(),
  },
  execute: async (args, ctx) => {
    const name = String(args.name ?? "").trim()
    if (!name) return "forge-skill: name is required (e.g., 'forge:brainstorm')"
    const mode = String(args.mode ?? "load").trim()

    const file = findForgeSkill(name)
    if (!file) {
      return `forge-skill: skill "${name}" not found.

Searched these locations for a SKILL.md:
${FORGE_SKILL_SEARCH_DIRS.map((d) => `  - ${d}/<skill-dir>/SKILL.md`).join("\n")}

Check:
- Did you spell the skill name correctly?
- Is the skill directory named after the part after the last ":"?
- Or run "opencode debug skill" to see all registered skills.`
    }

    const content = fs.readFileSync(file, "utf-8")

    if (mode === "inject") {
      return `<!-- forge-skill:${name} -->
The following skill is available to you. You can invoke it by name using the \`skill\` tool, or read the SKILL.md content below directly. The orchestrator has already loaded this skill's content into your context.

<skill name="${name}">
${content.trim()}
</skill>
<!-- /forge-skill:${name} -->

USAGE: Paste the above block verbatim into the subagent's prompt before calling the \`task\` tool. The subagent will see this content as part of its instructions.`
    }

    // mode = "load" (default)
    return `<forge-skill-loaded name="${name}">
${content.trim()}
</forge-skill-loaded>

✓ forge-skill: loaded "${name}" into your context.
File: ${file}

Now follow the instructions in this skill. If dispatching a subagent that also needs this skill, call forge-skill(mode="inject", name="${name}") to get the inject block.`
  },
})

const plugin = {
  id: "forge-plugin",
  server: () => ({
    tool: {
      "forge-skill": forgeSkillTool,
      punchcard: punchcardTool,
      "forge-check": forgeCheckTool,
    },
  }),
}

const src_default = plugin
export { src_default as default }
