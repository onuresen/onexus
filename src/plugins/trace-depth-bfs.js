/* Example plugin: BFS trace (N-hop neighborhood) */
(function () {
    const ONX = window.ONEXUS;
    if (!ONX || typeof ONX.registerPlugin !== "function") return;

    ONX.registerPlugin({
        id: "trace-depth-bfs",
        register(api) {
            api.registerTraceBehavior("bfsNhops", {
                label: "Trace: Neighborhood (N-hop BFS)",
                mode: "path",      // or 'upstream' / 'downstream'
                order: 10,
                when: ({ cy, node }) => !!cy && !!node,
                run: ({ cy, node, state }) => {
                    const d = state?.focusDepth ?? 2;
                    let frontier = node.collection();
                    let seen = frontier;
                    for (let hop = 1; hop <= d; hop++) {
                        const neigh = frontier.closedNeighborhood(":visible");
                        seen = seen.union(neigh);
                        frontier = neigh.nodes();
                    }
                    return { collection: seen, mode: "path", message: `BFS ${d}-hop` };
                }
            });
        }
    });
})();