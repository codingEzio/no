#!/usr/bin/env python3
"""Reproduce one public family rename with fonttools[woff] 4.60.1 and brotli 1.2.1."""
import hashlib
import json
from pathlib import Path
import sys

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def rename_font(source, destination, previous, family):
    """Change existing identity strings; prove every non-name table unchanged."""
    from fontTools.ttLib import TTFont
    before = TTFont(source, lazy=True, recalcTimestamp=False)
    if before['name'].getDebugName(1) != previous:
        raise ValueError('Candidate family differs: ' + source.name)
    tables = {tag: before.getTableData(tag) for tag in before.keys() if tag != 'GlyphOrder'}
    for record in before['name'].names:
        text = record.toUnicode()
        if previous in text:
            record.string = text.replace(previous, family)
    before.save(destination)
    after = TTFont(destination, lazy=True, recalcTimestamp=False)
    if set(before.keys()) != set(after.keys()):
        raise ValueError('Naming conversion changed table inventory')
    compared = []
    for tag, data in tables.items():
        if tag == 'name':
            continue
        current = after.getTableData(tag)
        if tag == 'head':
            # File-level checkSumAdjustment changes when the name table changes.
            current = current[:8] + b'\0' * 4 + current[12:]
            data = data[:8] + b'\0' * 4 + data[12:]
        if current != data:
            raise ValueError('Naming conversion changed table: ' + tag + ' / ' + source.name)
        compared.append(tag)
    for identifier in [1, 3, 4, 6, 16]:
        values = [r.toUnicode() for r in after['name'].names if r.nameID == identifier]
        if not values or any(previous in v for v in values):
            raise ValueError('Old primary name remains')
    return {'file': destination.name, 'previousFamily': previous, 'family': family,
            'sourceSha256': sha(source), 'sha256': sha(destination),
            'unchangedTables': compared, 'headDifference': 'checkSumAdjustment only'}


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: rename_public_font.py SOURCE DESTINATION OLD_FAMILY NEW_FAMILY")
    source, destination = map(Path, sys.argv[1:3])
    if destination.exists():
        raise SystemExit("destination exists")
    print(json.dumps(rename_font(source, destination, sys.argv[3], sys.argv[4]), indent=2))
