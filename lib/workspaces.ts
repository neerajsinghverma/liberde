/**
 * Workspaces: shared membership, roles, and spend policy.
 *
 * Deliberately additive. Every resource in Liberde is still owned by the user
 * who made it, and every query still filters by `user_id` — a workspace does
 * not re-parent anything. What it adds is the layer enterprise buyers actually
 * ask about: who is in the group, what each of them is allowed to do, and a
 * ceiling on what the group can spend.
 *
 * Making workspaces the owner of conversations, projects, and artifacts is the
 * natural next step, but it rewrites the tenancy predicate on roughly every
 * query in lib/db.ts, so it is kept out of this layer on purpose.
 */

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

export const WORKSPACE_ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

export const isWorkspaceRole = (v: unknown): v is WorkspaceRole =>
  typeof v === "string" && (WORKSPACE_ROLES as string[]).includes(v);

/**
 * What a role may do.
 *
 * - `view`     — see the workspace and its member list.
 * - `spend`    — run models whose cost lands against the workspace budget.
 * - `members`  — invite, remove, and re-role people below owner.
 * - `settings` — rename the workspace and set its budgets.
 * - `destroy`  — delete the workspace outright.
 */
export type Capability = "view" | "spend" | "members" | "settings" | "destroy";

const CAPABILITIES: Record<WorkspaceRole, ReadonlySet<Capability>> = {
  owner: new Set<Capability>(["view", "spend", "members", "settings", "destroy"]),
  admin: new Set<Capability>(["view", "spend", "members", "settings"]),
  member: new Set<Capability>(["view", "spend"]),
  // A viewer is for auditors and observers: present in the workspace, visible
  // in the member list, and unable to spend a cent of its budget.
  viewer: new Set<Capability>(["view"]),
};

export const can = (role: WorkspaceRole, capability: Capability): boolean =>
  CAPABILITIES[role]?.has(capability) ?? false;

/**
 * Whether `actor` may assign `target` as a role.
 *
 * An admin can manage members but must not be able to mint owners or demote
 * one — otherwise "admin" is quietly equivalent to "owner", and the role split
 * stops meaning anything in an access review.
 */
export function canAssignRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (!can(actor, "members")) return false;
  if (actor === "owner") return true;
  return target !== "owner";
}

export interface BudgetVerdict {
  allowed: boolean;
  /** User-facing explanation; only set when blocked. */
  reason?: string;
}

export interface WorkspaceBudget {
  name: string;
  /** Ceiling on the whole workspace's month-to-date spend. Null = uncapped. */
  monthlyBudgetUsd: number | null;
  /** Ceiling on one member's month-to-date spend. Null = uncapped. */
  perMemberBudgetUsd: number | null;
  /** Month-to-date spend across every member. */
  workspaceSpend: number;
  /** Month-to-date spend by the user being checked. */
  memberSpend: number;
  role: WorkspaceRole;
}

const money = (n: number) => "$" + n.toFixed(2);

/**
 * Apply every workspace a user belongs to and return the first rule that stops
 * them.
 *
 * The most restrictive workspace wins. A user in two workspaces is spending
 * against both budgets at once — there is no per-conversation workspace to
 * attribute the cost to yet — so the safe reading is that either ceiling can
 * hold them, and an operator who set a cap gets the cap they asked for.
 */
export function checkBudgets(budgets: WorkspaceBudget[]): BudgetVerdict {
  for (const b of budgets) {
    if (!can(b.role, "spend")) {
      return {
        allowed: false,
        reason: `You have view-only access to the "${b.name}" workspace, so you can't run models under it. Ask an owner or admin to change your role.`,
      };
    }
    if (b.monthlyBudgetUsd != null && b.workspaceSpend >= b.monthlyBudgetUsd) {
      return {
        allowed: false,
        reason: `The "${b.name}" workspace has used its monthly budget (${money(b.workspaceSpend)} of ${money(b.monthlyBudgetUsd)}). It resets at the start of next month, or an owner can raise it.`,
      };
    }
    if (b.perMemberBudgetUsd != null && b.memberSpend >= b.perMemberBudgetUsd) {
      return {
        allowed: false,
        reason: `You've used your monthly allowance in the "${b.name}" workspace (${money(b.memberSpend)} of ${money(b.perMemberBudgetUsd)}). It resets at the start of next month, or an owner can raise it.`,
      };
    }
  }
  return { allowed: true };
}
