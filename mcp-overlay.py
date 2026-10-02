#!/usr/bin/env python3
"""Render the per-agent MCP patch layer from the DSH_MCP_SERVERS environment.

The env carries the platform-resolved server list as JSON: ``[{"name": ...,
"url": ..., "headers": {...}}]``. ``name`` is the final ``serverName`` (the
platform sanitizes it to the ``^[A-Za-z0-9_-]{1,32}$`` pattern dsh-mcp-client
enforces at boot); entries without a ``url`` are skipped. Each server becomes
one ``- insert:`` block byte-identical to team-agent's legacy ``_render_cordis``
mcp rows — ``dsh-mcp-client`` takes a single server per composition entry, so
the row count is dynamic and cannot ride a static env-templated overlay row.
Absent/empty env renders an empty patch list, which applies as no rows at all
(the legacy "no servers, no rows" semantics). Malformed JSON fails loud; the
entrypoint aborts the boot rather than starting a silently un-MCP'd agent.

Usage: mcp-overlay.py OUT
"""

import json
import os
import sys
import textwrap

import yaml


def render(servers: object) -> str:
    if not isinstance(servers, list):
        raise SystemExit(f"mcp-overlay: DSH_MCP_SERVERS must be a JSON array, got {type(servers).__name__}")
    lines: list[str] = []
    for index, server in enumerate(servers):
        if not isinstance(server, dict):
            raise SystemExit(f"mcp-overlay: DSH_MCP_SERVERS entry {index} must be an object")
        if not server.get("url"):
            continue  # only streamable-http servers can be reached from the harness
        name = server.get("name")
        if not name:
            raise SystemExit(f"mcp-overlay: DSH_MCP_SERVERS entry {index} has a url but no name")
        config: dict = {"transport": "streamable-http", "serverName": name, "url": server["url"]}
        if server.get("headers"):
            config["headers"] = server["headers"]
        entry = {"id": f"mcp-{name}", "name": "@deepseek-ai/dsh-mcp-client", "config": config}
        body = yaml.safe_dump([entry], allow_unicode=True, default_flow_style=False, sort_keys=True)
        lines += ["- insert:", textwrap.indent(body.rstrip("\n"), "  "), ""]
    return "\n".join(lines) if lines else "[]\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"usage: {argv[0]} OUT", file=sys.stderr)
        return 2
    raw = (os.environ.get("DSH_MCP_SERVERS") or "").strip()
    try:
        servers = json.loads(raw) if raw else []
    except json.JSONDecodeError as exc:
        print(f"mcp-overlay: DSH_MCP_SERVERS is not valid JSON: {exc}", file=sys.stderr)
        return 1
    with open(argv[1], "w", encoding="utf-8") as fh:
        fh.write(render(servers))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
