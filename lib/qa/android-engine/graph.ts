import type { ScreenKind, ScreenState } from './types';

/**
 * The screen graph.
 *
 * Each unique screen signature is a node; each executed interaction is an
 * edge. The graph is what makes exploration terminate: it records which
 * (screen, action) pairs have already been tried so the engine never loops,
 * and it exposes the frontier of screens that still have untried actions.
 */

export interface GraphNode {
  signature: string;
  label: string;
  kind: ScreenKind;
  activity: string;
  firstSeenAt: number;
  visitCount: number;
  /** Interaction keys already executed from this screen. */
  triedActions: Set<string>;
  /** Interaction keys discovered but not yet executed. */
  pendingActions: Set<string>;
  /**
   * Actions parked because this screen's per-visit budget was spent — NOT
   * executed and NOT discarded. They are restored when the agent comes back
   * with budget to spend, so a busy screen can't monopolise a run while still
   * keeping its long tail of controls reachable.
   */
  deferredActions: Set<string>;
  /** True once every discovered action has been tried. */
  exhausted: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  action: string;
  /** Whether the action actually changed the screen. */
  navigated: boolean;
  at: number;
}

export class ScreenGraph {
  private nodes = new Map<string, GraphNode>();
  private edges: GraphEdge[] = [];

  /** Registers (or revisits) a screen, returning its node. */
  observe(state: ScreenState, discoveredActions: string[]): GraphNode {
    let node = this.nodes.get(state.signature);
    if (!node) {
      node = {
        signature: state.signature,
        label: state.label,
        kind: state.kind,
        activity: state.activity,
        firstSeenAt: state.capturedAt,
        visitCount: 0,
        triedActions: new Set(),
        pendingActions: new Set(),
        deferredActions: new Set(),
        exhausted: false,
      };
      this.nodes.set(state.signature, node);
    }
    node.visitCount += 1;

    // Merge newly discovered actions that haven't already been executed. An
    // action parked on a previous visit stays parked until it is restored.
    for (const key of discoveredActions) {
      if (!node.triedActions.has(key) && !node.deferredActions.has(key)) node.pendingActions.add(key);
    }
    node.exhausted = node.pendingActions.size === 0 && node.deferredActions.size === 0;
    return node;
  }

  markTried(signature: string, actionKey: string): void {
    const node = this.nodes.get(signature);
    if (!node) return;
    node.pendingActions.delete(actionKey);
    node.deferredActions.delete(actionKey);
    node.triedActions.add(actionKey);
    node.exhausted = node.pendingActions.size === 0 && node.deferredActions.size === 0;
  }

  /**
   * Parks an action for a later visit instead of executing or discarding it.
   *
   * The per-screen budget used to call {@link markTried} on everything it could
   * not afford, which recorded untried actions as tried: the screen went
   * `exhausted`, the frontier emptied, and the planner concluded the whole run
   * was finished while most of the app had never been touched.
   */
  defer(signature: string, actionKey: string): void {
    const node = this.nodes.get(signature);
    if (!node) return;
    if (node.triedActions.has(actionKey)) return;
    node.pendingActions.delete(actionKey);
    node.deferredActions.add(actionKey);
    // Still work outstanding here, so the node is NOT exhausted.
    node.exhausted = false;
  }

  /** Brings a screen's parked actions back into play. Returns how many. */
  restoreDeferred(signature: string): number {
    const node = this.nodes.get(signature);
    if (!node || node.deferredActions.size === 0) return 0;
    let restored = 0;
    for (const key of Array.from(node.deferredActions)) {
      node.deferredActions.delete(key);
      if (!node.triedActions.has(key)) { node.pendingActions.add(key); restored += 1; }
    }
    node.exhausted = node.pendingActions.size === 0;
    return restored;
  }

  /** Screens holding parked actions — real remaining work, off the frontier. */
  deferredFrontier(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.deferredActions.size > 0);
  }

  /** Total parked actions across every screen. */
  deferredCount(): number {
    return Array.from(this.nodes.values()).reduce((s, n) => s + n.deferredActions.size, 0);
  }

  addEdge(from: string, to: string, action: string, navigated: boolean): void {
    this.edges.push({ from, to, action, navigated, at: Date.now() });
  }

  get(signature: string): GraphNode | undefined {
    return this.nodes.get(signature);
  }

  has(signature: string): boolean {
    return this.nodes.has(signature);
  }

  /** Screens that still have untried actions. */
  frontier(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.pendingActions.size > 0);
  }

  isFullyExplored(): boolean {
    return this.frontier().length === 0 && this.nodes.size > 0;
  }

  get size(): number {
    return this.nodes.size;
  }

  allNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  allEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Shortest recorded route of actions between two known screens, over edges
   * that actually navigated. Returns null when no route was ever observed —
   * the caller then falls back to BACK rather than guessing.
   */
  pathBetween(from: string, to: string): string[] | null {
    if (from === to) return [];
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;

    const queue: Array<{ sig: string; path: string[] }> = [{ sig: from, path: [] }];
    const seen = new Set<string>([from]);

    while (queue.length > 0) {
      const { sig, path } = queue.shift()!;
      if (path.length > 8) continue; // long replays diverge; keep them short
      for (const e of this.edges) {
        if (e.from !== sig || !e.navigated || seen.has(e.to)) continue;
        const next = [...path, e.action];
        if (e.to === to) return next;
        seen.add(e.to);
        queue.push({ sig: e.to, path: next });
      }
    }
    return null;
  }

  /**
   * Nearest screen that still has outstanding work — pending OR deferred — and
   * the route to it. This is what lets the explorer navigate deliberately toward
   * remaining work instead of pressing BACK and hoping.
   */
  pathToWork(from: string): { target: string; path: string[] } | null {
    if (!this.nodes.has(from)) return null;
    const queue: Array<{ sig: string; path: string[] }> = [{ sig: from, path: [] }];
    const seen = new Set<string>([from]);

    while (queue.length > 0) {
      const { sig, path } = queue.shift()!;
      const node = this.nodes.get(sig);
      const hasWork = node && (node.pendingActions.size > 0 || node.deferredActions.size > 0);
      if (hasWork && path.length > 0) return { target: sig, path };
      if (path.length > 8) continue;

      for (const e of this.edges) {
        if (e.from !== sig || !e.navigated || seen.has(e.to)) continue;
        seen.add(e.to);
        queue.push({ sig: e.to, path: [...path, e.action] });
      }
    }
    return null;
  }

  /** Human-readable exploration map for the run report. */
  summary(): string {
    const lines: string[] = [];
    lines.push(`Screens discovered: ${this.nodes.size}`);
    for (const n of Array.from(this.nodes.values())) {
      lines.push(
        `  • ${n.label} [${n.kind}] — visits: ${n.visitCount}, actions tried: ${n.triedActions.size}, `
        + `pending: ${n.pendingActions.size}${n.deferredActions.size ? `, deferred: ${n.deferredActions.size}` : ''}`,
      );
    }
    const navigated = this.edges.filter((e) => e.navigated).length;
    lines.push(`Transitions: ${navigated} navigating / ${this.edges.length} total`);
    return lines.join('\n');
  }
}
