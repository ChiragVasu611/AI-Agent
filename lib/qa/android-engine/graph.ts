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
        exhausted: false,
      };
      this.nodes.set(state.signature, node);
    }
    node.visitCount += 1;

    // Merge newly discovered actions that haven't already been executed.
    for (const key of discoveredActions) {
      if (!node.triedActions.has(key)) node.pendingActions.add(key);
    }
    node.exhausted = node.pendingActions.size === 0;
    return node;
  }

  markTried(signature: string, actionKey: string): void {
    const node = this.nodes.get(signature);
    if (!node) return;
    node.pendingActions.delete(actionKey);
    node.triedActions.add(actionKey);
    node.exhausted = node.pendingActions.size === 0;
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
   * Breadth-first path of actions from `from` to any screen with pending work.
   * Used to navigate back to unexplored territory instead of restarting.
   */
  pathToFrontier(from: string): string[] | null {
    if (!this.nodes.has(from)) return null;
    const queue: Array<{ sig: string; path: string[] }> = [{ sig: from, path: [] }];
    const seen = new Set<string>([from]);

    while (queue.length > 0) {
      const { sig, path } = queue.shift()!;
      const node = this.nodes.get(sig);
      if (node && node.pendingActions.size > 0 && path.length > 0) return path;
      if (path.length > 6) continue; // keep replay paths short and reliable

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
        `  • ${n.label} [${n.kind}] — visits: ${n.visitCount}, actions tried: ${n.triedActions.size}, pending: ${n.pendingActions.size}`,
      );
    }
    const navigated = this.edges.filter((e) => e.navigated).length;
    lines.push(`Transitions: ${navigated} navigating / ${this.edges.length} total`);
    return lines.join('\n');
  }
}
