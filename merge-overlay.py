#!/usr/bin/env python3
"""Merge two dsh patch files into one --patch argument.

Both inputs (and the output) are top-level YAML lists of patch rows, the shape
dsh consumes via --patch. dsh's applyEntryPatches applies the rows of one file
sequentially: a row with `id` overrides the targeted entry at the row level
(config replaced wholesale), a row with `insert` appends entries. Concatenating
the agent rows after the base rows therefore IS the merge — the merged file
boots exactly as if base and agent had been applied in order. A Python-side
config deep-merge would silently keep base keys on same-id rows and diverge
from that contract.

`!!js` tagged expressions must reach dsh unevaluated, so the loader keeps them
as TaggedScalar and the dumper writes the tag back out.

Usage: merge-overlay.py BASE AGENT OUT
"""

import sys

import yaml


class TaggedScalar:
    def __init__(self, tag, value):
        self.tag = tag
        self.value = value


class OverlayLoader(yaml.SafeLoader):
    pass


def _construct_tagged(loader, suffix, node):
    if not isinstance(node, yaml.ScalarNode):
        raise ValueError(f"unsupported tagged node {node.tag} (line {node.start_mark.line + 1})")
    return TaggedScalar(node.tag, loader.construct_scalar(node))


OverlayLoader.add_multi_constructor("tag:yaml.org,2002:", _construct_tagged)


def _represent_tagged(dumper, data):
    return dumper.represent_scalar(data.tag, data.value)


yaml.SafeDumper.add_representer(TaggedScalar, _represent_tagged)


def load(path):
    with open(path) as f:
        return yaml.load(f, Loader=OverlayLoader)


def merge_rows(base, agent):
    return [dict(row) for row in (base or [])] + [dict(row) for row in (agent or [])]


def main(argv):
    if len(argv) != 4:
        print(f"usage: {argv[0]} BASE AGENT OUT", file=sys.stderr)
        return 2
    base_path, agent_path, out_path = argv[1:4]
    merged = merge_rows(load(base_path), load(agent_path))
    with open(out_path, "w") as f:
        yaml.safe_dump(merged, f, allow_unicode=True, sort_keys=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
