/**
 * permission-hook.ts - a PreToolUse hook that answers the permission question for
 * writes, using the policy in policy.ts.
 *
 * Claude Code runs this before every Write/Edit, passing the tool call as JSON on
 * stdin. Returning `permissionDecision: "allow"` approves the call without a prompt,
 * which is the only mechanism that reaches writes inside `.claude/` - and unlike an
 * MCP permission-prompt tool, a hook needs no network and no MCP server, so it also
 * works on a machine whose policy blocks MCP.
 *
 * Silence (empty output) means "no opinion": the normal permission rules apply. The
 * hook only ever speaks up to allow a path the policy names, or to deny one it
 * positively objects to.
 */

import { decide } from "./policy.ts";

const raw = await new Response(Bun.stdin.stream()).text();

let payload: any = {};
try {
  payload = JSON.parse(raw || "{}");
} catch {
  process.exit(0); // malformed input: stay out of the way
}

const toolName = String(payload.tool_name ?? "");
const toolInput = payload.tool_input ?? {};
const workspace = process.env.STUDIO_WORKSPACE ?? payload.cwd ?? process.cwd();

const verdict = decide(toolName, toolInput, workspace);

// Only assert an opinion when the policy recognises the path. "not the policy's
// business" and unknown paths fall through to the settings rules, which deny by default.
if (verdict.allow) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: `Job Studio policy: ${verdict.why}`,
      },
    }),
  );
} else if (!/not the policy's business/.test(verdict.why)) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Job Studio policy: ${verdict.why}`,
      },
    }),
  );
}

process.exit(0);
